import { buildGeneratorPolyline } from '../../devices/engine';
import { applyNoteStageColorPrograms } from '../../devices/color/engine';
import type { GeneratorChain, MaskEffectNode } from '../../shared/model';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type { Polyline, SceneInstance } from '../core-types';
import { applyTransformToPolyline } from '../geometry';
import {
  projectSceneToActivationFrame,
  resolveActiveTilesFromPolylines,
} from './active';
import {
  MIN_NOTE_DURATION,
  POLYLINE_STEP,
  SAMPLES_PER_BEAT,
  TILE_COUNT,
} from './constants';
import { fitNotesToTimeline } from './timeline-fit';
import { isGeneratorNode, resolveMaskTime, resolveMutedSources, splitChainByGroup } from './groups';
import {
  buildSceneInstances,
  createSceneInstanceFromNode,
  resolveReverseParityAfter,
} from './layers';
import type {
  GroupEvaluationContext,
  GroupId,
  MaskTimeKind,
  OpenNoteState,
  TimedOutputNote,
} from './types';

export interface MaskDebugSnapshot {
  maskDeviceId: string;
  consumingGroupId: GroupId;
  sourceKind: MaskEffectNode['params']['sourceKind'];
  sourceDomain: MaskEffectNode['params']['sourceDomain'];
  sourceId: string | null;
  timeKind: MaskTimeKind;
  sourcePolylines: Polyline[];
  sourceActiveTiles: Set<number>;
  consumerPolylinesBeforeMask: Polyline[];
  consumerPolylinesAfterMask: Polyline[];
}

const projectSceneInstancePolyline = (
  sceneInstance: SceneInstance,
  time: number,
): Polyline | null => {
  const polyline = buildGeneratorPolyline(sceneInstance, time, POLYLINE_STEP);
  if (!polyline) {
    return null;
  }

  return applyTransformToPolyline({
    ...polyline,
    clipStack: sceneInstance.clipStack,
  }, sceneInstance.spatial);
};

const projectPolylinesAtTime = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  time: number,
): Polyline[] => {
  const polylines: Polyline[] = [];

  for (const sceneInstance of sceneInstances) {
    const polyline = projectSceneInstancePolyline(sceneInstance, time);
    if (polyline) {
      polylines.push(polyline);
    }
  }

  return polylines;
};

const buildGroupById = (
  groupChains: ReadonlyArray<{ id: GroupId; devices: GeneratorChain['devices'] }>,
): Map<GroupId, { id: GroupId; devices: GeneratorChain['devices'] }> => {
  const groupById = new Map<GroupId, { id: GroupId; devices: GeneratorChain['devices'] }>();
  for (const group of groupChains) {
    groupById.set(group.id, group);
  }
  return groupById;
};

const buildGeneratorById = (
  chain: GeneratorChain,
): Map<string, Extract<GeneratorChain['devices'][number], { kind: 'waterdrop' | 'scanner' | 'spiral' }>> => {
  const generatorById = new Map<string, Extract<GeneratorChain['devices'][number], { kind: 'waterdrop' | 'scanner' | 'spiral' }>>();
  for (const device of chain.devices) {
    if (isGeneratorNode(device)) {
      generatorById.set(device.id, device);
    }
  }
  return generatorById;
};

const buildMaskSourceCacheKey = (
  sourceGroupId: string,
  consumingGroupId?: GroupId,
  consumingDeviceIndex?: number,
): string => `group:${sourceGroupId}|consumer:${consumingGroupId ?? 'none'}|index:${consumingDeviceIndex ?? -1}`;

const createBaseChainForMaskSource = (
  context: GroupEvaluationContext,
  consumingGroupId: GroupId | undefined,
  consumingDeviceIndex: number | undefined,
): GeneratorChain => {
  if (consumingGroupId === undefined || consumingDeviceIndex === undefined) {
    return context.baseChain;
  }

  let groupDeviceCount = 0;
  return {
    devices: context.baseChain.devices.filter((device) => {
      if (normalizeOptionalId(device.groupId) !== consumingGroupId) {
        return true;
      }

      const keep = groupDeviceCount < consumingDeviceIndex;
      groupDeviceCount += 1;
      return keep;
    }),
    groupStateById: context.baseChain.groupStateById,
  };
};

const createSourceEvaluationContext = (
  sourceChain: GeneratorChain,
  context: GroupEvaluationContext,
  time: number,
  unmutedGroupId: GroupId,
): GroupEvaluationContext => {
  const groupChains = splitChainByGroup(sourceChain);
  const groupById = buildGroupById(groupChains);
  const { mutedGroupIds, mutedGeneratorIds } = resolveMutedSources(sourceChain);

  if (unmutedGroupId) {
    mutedGroupIds.delete(unmutedGroupId);
    const sourceGroup = groupById.get(unmutedGroupId);
    if (sourceGroup) {
      for (const device of sourceGroup.devices) {
        if (isGeneratorNode(device)) {
          mutedGeneratorIds.delete(device.id);
        }
      }
    }
  }

  return {
    time,
    timeReversed: 1 - time,
    buttonIndex: context.buttonIndex,
    chain: sourceChain,
    baseChain: sourceChain,
    groupStateById: sourceChain.groupStateById,
    worldBounds: context.worldBounds,
    groupChains,
    groupById,
    generatorById: buildGeneratorById(sourceChain),
    mutedGroupIds,
    mutedGeneratorIds,
    cache: {
      sceneInstancesByGroup: new Map(),
      outputPolylinesByGroup: new Map(),
      maskSourceOutputNotesByKey: new Map(),
    },
  };
};

const closeOpenNote = (
  notes: TimedOutputNote[],
  pitch: number,
  open: OpenNoteState,
  endBeat: number,
): void => {
  const orderedStart = Math.max(Math.min(open.startBeat, endBeat), 0);
  const orderedEnd = Math.max(Math.max(open.startBeat, endBeat), 0);
  notes.push({
    pitch,
    channel: open.channel,
    startBeat: orderedStart,
    durationBeats: Math.max(orderedEnd - orderedStart, MIN_NOTE_DURATION),
    velocity: open.velocity,
    originId: open.originId,
  });
};

const collectGroupOutputNotes = (
  sourceGroupId: string,
  context: GroupEvaluationContext,
  consumingGroupId?: GroupId,
  consumingDeviceIndex?: number,
): TimedOutputNote[] => {
  const notes: TimedOutputNote[] = [];
  const openByPitch = new Map<number, OpenNoteState>();
  const sourceChain = createBaseChainForMaskSource(context, consumingGroupId, consumingDeviceIndex);

  for (let step = 0; step < SAMPLES_PER_BEAT; step += 1) {
    const sample = step / SAMPLES_PER_BEAT;
    const sourceContext = createSourceEvaluationContext(
      sourceChain,
      context,
      sample,
      sourceGroupId,
    );
    const activeByPitch = projectSceneToActivationFrame(
      buildOutputGroupSceneInstances(sourceGroupId, sourceContext),
      sample,
      context.buttonIndex,
    ).activeByPitch;

    for (const [pitch, open] of openByPitch.entries()) {
      if (activeByPitch.has(pitch)) {
        continue;
      }
      closeOpenNote(notes, pitch, open, sample);
      openByPitch.delete(pitch);
    }

    for (const [pitch, active] of activeByPitch.entries()) {
      const existing = openByPitch.get(pitch);
      if (
        existing
        && existing.velocity === active.velocity
        && existing.channel === active.channel
        && existing.originId === active.originId
      ) {
        continue;
      }

      if (existing) {
        closeOpenNote(notes, pitch, existing, sample);
      }

      openByPitch.set(pitch, {
        startBeat: sample,
        velocity: active.velocity,
        channel: active.channel,
        originId: active.originId,
      });
    }
  }

  for (const [pitch, open] of openByPitch.entries()) {
    closeOpenNote(notes, pitch, open, 1);
  }

  return applyNoteStageColorPrograms(sourceChain, notes, MIN_NOTE_DURATION);
};

const resolveGroupSourceOutputNotes = (
  sourceGroupId: string,
  context: GroupEvaluationContext,
  consumingGroupId?: GroupId,
  consumingDeviceIndex?: number,
): ReadonlyArray<TimedOutputNote> => {
  const cacheKey = buildMaskSourceCacheKey(
    sourceGroupId,
    consumingGroupId,
    consumingDeviceIndex,
  );
  const cached = context.cache.maskSourceOutputNotesByKey.get(cacheKey);
  if (cached) {
    return cached;
  }

  const notes = collectGroupOutputNotes(
    sourceGroupId,
    context,
    consumingGroupId,
    consumingDeviceIndex,
  );
  const fittedNotes = fitNotesToTimeline(notes).fittedNotes;
  context.cache.maskSourceOutputNotesByKey.set(cacheKey, fittedNotes);
  return fittedNotes;
};

const resolveGroupSourceOutputActiveTiles = (
  sourceGroupId: string,
  context: GroupEvaluationContext,
  timeKind: MaskTimeKind,
  consumingGroupId?: GroupId,
  consumingDeviceIndex?: number,
): Set<number> => {
  const time = resolveMaskTime(context, timeKind);
  const activeAddresses = new Set<string>();

  for (const note of resolveGroupSourceOutputNotes(
    sourceGroupId,
    context,
    consumingGroupId,
    consumingDeviceIndex,
  )) {
    if (note.startBeat <= time && time < note.startBeat + note.durationBeats) {
      activeAddresses.add(`${note.channel}:${note.pitch}`);
    }
  }

  const activeTiles = new Set<number>();
  for (const group of context.buttonIndex.groups) {
    if (group.buttons.some((button) =>
      activeAddresses.has(`${button.output.channel}:${button.output.number}`))) {
      activeTiles.add(group.y * TILE_COUNT + group.x);
    }
  }

  return activeTiles;
};

const buildCheckpointSceneInstances = (
  groupId: GroupId,
  context: GroupEvaluationContext,
  endExclusive: number,
): SceneInstance[] => {
  const group = context.groupById.get(groupId);
  if (!group) {
    return [];
  }

  const slicedChain: GeneratorChain = {
    devices: group.devices.slice(0, endExclusive),
    groupStateById: context.groupStateById,
  };

  return buildSceneInstances(slicedChain, context.worldBounds, (effect, deviceIndex) => {
    if (effect.kind !== 'mask') {
      return null;
    }

    const reverseParityAfter = resolveReverseParityAfter(slicedChain, slicedChain.devices);
    const reverseAfter = reverseParityAfter[deviceIndex] === true;
    const timeKind: MaskTimeKind = reverseAfter ? 'reversed' : 'forward';
    return resolveMaskEffectContext(effect, context, timeKind, groupId, deviceIndex);
  });
};

const resolveGroupSourceSceneInstances = (
  groupId: GroupId,
  context: GroupEvaluationContext,
  consumingGroupId?: GroupId,
  consumingDeviceIndex?: number,
): SceneInstance[] => {
  if (groupId === null) {
    return [];
  }

  if (consumingDeviceIndex !== undefined && groupId === consumingGroupId) {
    return buildCheckpointSceneInstances(groupId, context, consumingDeviceIndex);
  }

  return buildGroupSceneInstances(groupId, context);
};

const resolveGeneratorSourceSceneInstances = (
  generatorId: string,
  context: GroupEvaluationContext,
  consumingGroupId?: GroupId,
  consumingDeviceIndex?: number,
): SceneInstance[] => {
  const generator = context.generatorById.get(generatorId);
  if (!generator || !isDeviceEffectivelyEnabled(context.chain, generator)) {
    return [];
  }

  if (
    consumingDeviceIndex !== undefined
    && normalizeOptionalId(generator.groupId) === consumingGroupId
  ) {
    const group = context.groupById.get(consumingGroupId);
    const generatorIndex = group?.devices.findIndex((device) => device.id === generator.id) ?? -1;
    if (generatorIndex === -1 || generatorIndex >= consumingDeviceIndex) {
      return [];
    }
  }

  const sceneInstance = createSceneInstanceFromNode(generator, context.worldBounds);
  return sceneInstance ? [sceneInstance] : [];
};

const resolveGroupSourcePolylines = (
  groupId: GroupId,
  context: GroupEvaluationContext,
  timeKind: MaskTimeKind,
  consumingGroupId?: GroupId,
  consumingDeviceIndex?: number,
): Polyline[] => projectPolylinesAtTime(
  resolveGroupSourceSceneInstances(
    groupId,
    context,
    consumingGroupId,
    consumingDeviceIndex,
  ),
  resolveMaskTime(context, timeKind),
);

const resolveGeneratorSourcePolylines = (
  generatorId: string,
  context: GroupEvaluationContext,
  timeKind: MaskTimeKind,
  consumingGroupId?: GroupId,
  consumingDeviceIndex?: number,
): Polyline[] => projectPolylinesAtTime(
  resolveGeneratorSourceSceneInstances(
    generatorId,
    context,
    consumingGroupId,
    consumingDeviceIndex,
  ),
  resolveMaskTime(context, timeKind),
);

const resolveGroupSourceActiveTiles = (
  groupId: GroupId,
  context: GroupEvaluationContext,
  timeKind: MaskTimeKind,
  consumingGroupId?: GroupId,
  consumingDeviceIndex?: number,
): Set<number> => {
  if (!groupId) {
    return new Set();
  }

  return resolveGroupSourceOutputActiveTiles(
    groupId,
    context,
    timeKind,
    consumingGroupId,
    consumingDeviceIndex,
  );
};

const resolveGeneratorSourceActiveTiles = (
  generatorId: string,
  context: GroupEvaluationContext,
  timeKind: MaskTimeKind,
  consumingGroupId?: GroupId,
  consumingDeviceIndex?: number,
): Set<number> => projectSceneToActivationFrame(
  resolveGeneratorSourceSceneInstances(
    generatorId,
    context,
    consumingGroupId,
    consumingDeviceIndex,
  ),
  resolveMaskTime(context, timeKind),
  context.buttonIndex,
).activeTiles;

const resolveGroupSourceTiles = (
  sourceDomain: MaskEffectNode['params']['sourceDomain'],
  groupId: GroupId,
  context: GroupEvaluationContext,
  timeKind: MaskTimeKind,
  consumingGroupId?: GroupId,
  consumingDeviceIndex?: number,
): Set<number> => {
  if (sourceDomain === 'scene') {
    return resolveActiveTilesFromPolylines(
      resolveGroupSourcePolylines(
        groupId,
        context,
        timeKind,
        consumingGroupId,
        consumingDeviceIndex,
      ),
    );
  }

  return resolveGroupSourceActiveTiles(
    groupId,
    context,
    timeKind,
    consumingGroupId,
    consumingDeviceIndex,
  );
};

const resolveGeneratorSourceTiles = (
  sourceDomain: MaskEffectNode['params']['sourceDomain'],
  generatorId: string,
  context: GroupEvaluationContext,
  timeKind: MaskTimeKind,
  consumingGroupId?: GroupId,
  consumingDeviceIndex?: number,
): Set<number> => {
  if (sourceDomain === 'scene') {
    return resolveActiveTilesFromPolylines(
      resolveGeneratorSourcePolylines(
        generatorId,
        context,
        timeKind,
        consumingGroupId,
        consumingDeviceIndex,
      ),
    );
  }

  return resolveGeneratorSourceActiveTiles(
    generatorId,
    context,
    timeKind,
    consumingGroupId,
    consumingDeviceIndex,
  );
};

const resolveMaskEffectContext = (
  effect: MaskEffectNode,
  context: GroupEvaluationContext,
  timeKind: MaskTimeKind,
  consumingGroupId: GroupId,
  consumingDeviceIndex: number,
): { tilesOverride?: Iterable<number> | null } => {
  const sourceKind = effect.params.sourceKind;
  if (sourceKind === 'group') {
    const sourceId = normalizeOptionalId(effect.params.sourceId);
    if (!sourceId) {
      return { tilesOverride: [] };
    }
    return {
      tilesOverride: resolveGroupSourceTiles(
        effect.params.sourceDomain,
        sourceId,
        context,
        timeKind,
        consumingGroupId,
        consumingDeviceIndex,
      ),
    };
  }

  if (sourceKind === 'generator') {
    const sourceId = normalizeOptionalId(effect.params.sourceId);
    if (!sourceId) {
      return { tilesOverride: [] };
    }
    return {
      tilesOverride: resolveGeneratorSourceTiles(
        effect.params.sourceDomain,
        sourceId,
        context,
        timeKind,
        consumingGroupId,
        consumingDeviceIndex,
      ),
    };
  }

  return {
    tilesOverride: effect.params.tiles,
  };
};

const buildGroupSceneInstances = (
  groupId: GroupId,
  context: GroupEvaluationContext,
): SceneInstance[] => {
  const cached = context.cache.sceneInstancesByGroup.get(groupId);
  if (cached) {
    return cached;
  }

  const group = context.groupById.get(groupId);
  if (!group) {
    const empty: SceneInstance[] = [];
    context.cache.sceneInstancesByGroup.set(groupId, empty);
    return empty;
  }

  const groupChain: GeneratorChain = {
    devices: group.devices,
    groupStateById: context.groupStateById,
  };
  const reverseParityAfter = resolveReverseParityAfter(groupChain, group.devices);
  const sceneInstances = buildSceneInstances(
    groupChain,
    context.worldBounds,
    (effect, deviceIndex) => {
      if (effect.kind !== 'mask') {
        return null;
      }

      const reverseAfter = reverseParityAfter[deviceIndex] === true;
      const timeKind: MaskTimeKind = reverseAfter ? 'reversed' : 'forward';
      return resolveMaskEffectContext(effect, context, timeKind, groupId, deviceIndex);
    },
  );

  context.cache.sceneInstancesByGroup.set(groupId, sceneInstances);
  return sceneInstances;
};

const buildOutputGroupSceneInstances = (
  groupId: GroupId,
  context: GroupEvaluationContext,
): SceneInstance[] => {
  if (groupId && context.mutedGroupIds.has(groupId)) {
    return [];
  }

  const sceneInstances = buildGroupSceneInstances(groupId, context);
  return context.mutedGeneratorIds.size > 0
    ? sceneInstances.filter((sceneInstance) => !context.mutedGeneratorIds.has(sceneInstance.originId))
    : sceneInstances;
};

const buildOutputGroupPolylinesAtTime = (
  groupId: GroupId,
  context: GroupEvaluationContext,
): Polyline[] => {
  const cached = context.cache.outputPolylinesByGroup.get(groupId);
  if (cached) {
    return cached;
  }

  const sceneInstances = buildOutputGroupSceneInstances(groupId, context);
  const polylines = sceneInstances.length > 0
    ? projectPolylinesAtTime(sceneInstances, context.time)
    : [];
  context.cache.outputPolylinesByGroup.set(groupId, polylines);
  return polylines;
};

export const buildSceneInstancesForAllGroups = (
  context: GroupEvaluationContext,
): SceneInstance[] => {
  const sceneInstances: SceneInstance[] = [];

  for (const group of context.groupChains) {
    sceneInstances.push(...buildOutputGroupSceneInstances(group.id, context));
  }

  return sceneInstances;
};

export const buildPolylinesForAllGroups = (
  context: GroupEvaluationContext,
): Polyline[] => {
  const polylines: Polyline[] = [];

  for (const group of context.groupChains) {
    polylines.push(...buildOutputGroupPolylinesAtTime(group.id, context));
  }

  return polylines;
};

export const evaluateMaskDebugSnapshot = (
  maskDeviceId: string,
  context: GroupEvaluationContext,
): MaskDebugSnapshot | null => {
  for (const group of context.groupChains) {
    const maskIndex = group.devices.findIndex((device) =>
      device.id === maskDeviceId && device.kind === 'mask');
    if (maskIndex < 0) {
      continue;
    }

    const maskDevice = group.devices[maskIndex];
    if (maskDevice.kind !== 'mask') {
      return null;
    }

    const reverseParityAfter = resolveReverseParityAfter(
      {
        devices: group.devices,
        groupStateById: context.groupStateById,
      },
      group.devices,
    );
    const timeKind: MaskTimeKind = reverseParityAfter[maskIndex] === true ? 'reversed' : 'forward';

    let sourcePolylines: Polyline[] = [];
    const sourceId = normalizeOptionalId(maskDevice.params.sourceId);
    if (maskDevice.params.sourceKind === 'group' && sourceId) {
      sourcePolylines = resolveGroupSourcePolylines(
        sourceId,
        context,
        timeKind,
        group.id,
        maskIndex,
      );
    } else if (maskDevice.params.sourceKind === 'generator' && sourceId) {
      sourcePolylines = resolveGeneratorSourcePolylines(
        sourceId,
        context,
        timeKind,
        group.id,
        maskIndex,
      );
    }

    return {
      maskDeviceId,
      consumingGroupId: group.id,
      sourceKind: maskDevice.params.sourceKind,
      sourceDomain: maskDevice.params.sourceDomain,
      sourceId,
      timeKind,
      sourcePolylines,
      sourceActiveTiles: maskDevice.params.sourceKind === 'group' && sourceId
        ? resolveGroupSourceTiles(
          maskDevice.params.sourceDomain,
          sourceId,
          context,
          timeKind,
          group.id,
          maskIndex,
        )
        : (maskDevice.params.sourceKind === 'generator' && sourceId
          ? resolveGeneratorSourceTiles(
            maskDevice.params.sourceDomain,
            sourceId,
            context,
            timeKind,
            group.id,
            maskIndex,
          )
          : new Set()),
      consumerPolylinesBeforeMask: projectPolylinesAtTime(
        buildCheckpointSceneInstances(group.id, context, maskIndex),
        context.time,
      ),
      consumerPolylinesAfterMask: buildOutputGroupPolylinesAtTime(group.id, context),
    };
  }

  return null;
};
