import { buildGeneratorPolyline } from '../../devices/engine';
import {
  applyColorProgramsDetailed,
  type ClipNoteWithOrigin,
  type ColorGuideWarp,
} from '../../devices/color/engine';
import type { GeneratorChain, MaskEffectNode } from '../../shared/model';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type { Polyline, SceneInstance } from '../core-types';
import {
  applyTransformToPolyline,
} from '../geometry';
import { resolveActiveByPitch, resolveActiveTilesFromPolylines } from './active';
import { MIN_NOTE_DURATION, POLYLINE_STEP, SAMPLES_PER_BEAT } from './constants';
import { pickByTimeKind, resolveMaskTime } from './groups';
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
  OriginWindow,
} from './types';

export interface MaskDebugSnapshot {
  maskDeviceId: string;
  consumingGroupId: GroupId;
  sourceKind: MaskEffectNode['params']['sourceKind'];
  sourceId: string | null;
  timeKind: MaskTimeKind;
  sourcePolylines: Polyline[];
  sourceActiveTiles: Set<number>;
  consumerPolylinesBeforeMask: Polyline[];
  consumerPolylinesAfterMask: Polyline[];
}

const getOriginFitTime = (
  t: number,
  window: OriginWindow | undefined,
): number | null => {
  if (!window) {
    return t;
  }
  if (!Number.isFinite(window.min) || !Number.isFinite(window.max)) {
    return t;
  }

  const span = window.max - window.min;
  if (!Number.isFinite(span) || span <= 0) {
    return t;
  }

  return window.min + t * span;
};

const projectSceneInstancePolyline = (
  sceneInstance: SceneInstance,
  t01: number,
): Polyline | null => {
  const polyline = buildGeneratorPolyline(sceneInstance, t01, POLYLINE_STEP);
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
  t01: number,
  originWindows?: Map<string, OriginWindow>,
): Polyline[] => {
  const polylines: Polyline[] = [];

  for (const sceneInstance of sceneInstances) {
    const fitTime = getOriginFitTime(t01, originWindows?.get(sceneInstance.originId));
    if (fitTime === null) {
      continue;
    }

    const polyline = projectSceneInstancePolyline(sceneInstance, fitTime);
    if (polyline) {
      polylines.push(polyline);
    }
  }

  return polylines;
};

const sortClipNotes = (notes: ClipNoteWithOrigin[]): void => {
  notes.sort((left, right) =>
    left.startBeat - right.startBeat
    || left.pitch - right.pitch
    || left.channel - right.channel);
};

const closeOpenNote = (
  notes: ClipNoteWithOrigin[],
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

const collectSourceNotesForSceneInstances = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  context: GroupEvaluationContext,
): ClipNoteWithOrigin[] => {
  if (sceneInstances.length === 0) {
    return [];
  }

  const openByPitch = new Map<number, OpenNoteState>();
  const notes: ClipNoteWithOrigin[] = [];

  for (let step = 0; step < SAMPLES_PER_BEAT; step += 1) {
    const sample = step / SAMPLES_PER_BEAT;
    const activeByPitch = resolveActiveByPitch(
      projectPolylinesAtTime(sceneInstances, sample),
      context.buttonIndex,
    );

    for (const [pitch, open] of openByPitch.entries()) {
      if (activeByPitch.has(pitch)) {
        continue;
      }
      closeOpenNote(notes, pitch, open, sample);
      openByPitch.delete(pitch);
    }

    for (const [pitch, active] of activeByPitch.entries()) {
      const existing = openByPitch.get(pitch);
      if (!existing) {
        openByPitch.set(pitch, {
          startBeat: sample,
          velocity: active.velocity,
          channel: active.channel,
          originId: active.originId,
        });
        continue;
      }

      if (
        existing.velocity === active.velocity
        && existing.channel === active.channel
        && existing.originId === active.originId
      ) {
        continue;
      }

      closeOpenNote(notes, pitch, existing, sample);
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

  sortClipNotes(notes);
  return notes;
};

const resolveGuideBeat = (
  beat01: number,
  warp: ColorGuideWarp | undefined,
): number => {
  if (!warp || !Number.isFinite(warp.scale) || warp.scale >= 1) {
    return beat01;
  }

  const sourceSpan = warp.sourceEndBeat - warp.sourceStartBeat;
  if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
    return beat01;
  }

  const relativeBeat = Math.max(0, beat01 - warp.sourceStartBeat);
  const advancedBeat = warp.sourceStartBeat + Math.min(relativeBeat / warp.scale, sourceSpan);
  return Math.min(Math.max(advancedBeat, 0), 1);
};

const resolveGroupSourcePolylines = (
  groupId: GroupId,
  context: GroupEvaluationContext,
  timeKind: MaskTimeKind,
  consumingGroupId?: GroupId,
  consumingDeviceIndex?: number,
): Polyline[] => {
  if (groupId === null) {
    return [];
  }

  if (consumingDeviceIndex !== undefined && groupId === consumingGroupId) {
    const group = context.groupById.get(groupId);
    if (!group) {
      return [];
    }

    const slicedChain: GeneratorChain = {
      devices: group.devices.slice(0, consumingDeviceIndex),
      groupStateById: context.groupStateById,
    };
    const slicedSceneInstances = buildSceneInstances(slicedChain, context.worldBounds, (effect, deviceIndex) => {
      if (effect.kind !== 'mask') {
        return null;
      }

      const reverseParityAfter = resolveReverseParityAfter(slicedChain, slicedChain.devices);
      const reverseAfter = reverseParityAfter[deviceIndex] === true;
      const sliceTimeKind: MaskTimeKind = reverseAfter ? 'reversed' : 'forward';
      return resolveMaskEffectContext(effect, context, sliceTimeKind, groupId, deviceIndex);
    });
    return buildGuidedPolylinesAtTime(
      slicedSceneInstances,
      resolveMaskTime(context, timeKind),
      buildColorGuideWarpForChain(slicedChain, slicedSceneInstances, context),
    );
  }

  const cache = pickByTimeKind(
    timeKind,
    context.cache.sourcePolylinesByGroup,
    context.cache.sourcePolylinesByGroupReversed,
  );
  const cached = cache.get(groupId);
  if (cached) {
    return cached;
  }

  const resolving = pickByTimeKind(
    timeKind,
    context.cache.resolvingSourcePolylinesByGroup,
    context.cache.resolvingSourcePolylinesByGroupReversed,
  );
  if (resolving.has(groupId)) {
    return [];
  }

  const group = context.groupById.get(groupId);
  if (!group) {
    const empty: Polyline[] = [];
    cache.set(groupId, empty);
    return empty;
  }

  resolving.add(groupId);
  const polylines = buildGuidedPolylinesAtTime(
    buildGroupSceneInstances(groupId, context),
    resolveMaskTime(context, timeKind),
    buildSourceColorGuideWarpByGroup(groupId, context),
  );
  resolving.delete(groupId);
  cache.set(groupId, polylines);
  return polylines;
};

const resolveGeneratorSourcePolylines = (
  generatorId: string,
  context: GroupEvaluationContext,
  timeKind: MaskTimeKind,
  consumingGroupId?: GroupId,
  consumingDeviceIndex?: number,
): Polyline[] => {
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

    const slicedChain: GeneratorChain = {
      devices: group.devices.slice(0, consumingDeviceIndex),
      groupStateById: context.groupStateById,
    };
    const slicedSceneInstances = buildSceneInstances(slicedChain, context.worldBounds, (effect, deviceIndex) => {
      if (effect.kind !== 'mask') {
        return null;
      }

      const reverseParityAfter = resolveReverseParityAfter(slicedChain, slicedChain.devices);
      const reverseAfter = reverseParityAfter[deviceIndex] === true;
      const sliceTimeKind: MaskTimeKind = reverseAfter ? 'reversed' : 'forward';
      return resolveMaskEffectContext(effect, context, sliceTimeKind, consumingGroupId, deviceIndex);
    });

    const guideWarp = buildColorGuideWarpForChain(slicedChain, slicedSceneInstances, context).get(generator.id);
    return projectPolylinesAtTime(
      [createSceneInstanceFromNode(generator, context.worldBounds)].filter((sceneInstance): sceneInstance is SceneInstance => sceneInstance !== null),
      resolveGuideBeat(resolveMaskTime(context, timeKind), guideWarp),
    );
  }

  const sceneInstance = createSceneInstanceFromNode(generator, context.worldBounds);
  if (!sceneInstance) {
    return [];
  }

  const time = resolveMaskTime(context, timeKind);
  const groupId = normalizeOptionalId(generator.groupId);
  const guideWarp = buildSourceColorGuideWarpByGroup(groupId, context).get(generator.id);
  return projectPolylinesAtTime(
    [sceneInstance],
    resolveGuideBeat(time, guideWarp),
  );
};

const resolveGroupSourceActiveTiles = (
  groupId: GroupId,
  context: GroupEvaluationContext,
  timeKind: MaskTimeKind,
  consumingGroupId?: GroupId,
  consumingDeviceIndex?: number,
): Set<number> => resolveActiveTilesFromPolylines(
  resolveGroupSourcePolylines(
    groupId,
    context,
    timeKind,
    consumingGroupId,
    consumingDeviceIndex,
  ),
);

const resolveGeneratorSourceActiveTiles = (
  generatorId: string,
  context: GroupEvaluationContext,
  timeKind: MaskTimeKind,
  consumingGroupId?: GroupId,
  consumingDeviceIndex?: number,
): Set<number> => resolveActiveTilesFromPolylines(
  resolveGeneratorSourcePolylines(
    generatorId,
    context,
    timeKind,
    consumingGroupId,
    consumingDeviceIndex,
  ),
);

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
      tilesOverride: resolveGroupSourceActiveTiles(
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
      tilesOverride: resolveGeneratorSourceActiveTiles(
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

const buildSourceColorGuideWarpByGroup = (
  groupId: GroupId,
  context: GroupEvaluationContext,
): ReadonlyMap<string, ColorGuideWarp> => {
  const cached = context.cache.sourceColorGuideWarpByGroup.get(groupId);
  if (cached) {
    return cached;
  }

  const group = context.groupById.get(groupId);
  if (!group) {
    const empty = new Map<string, ColorGuideWarp>();
    context.cache.sourceColorGuideWarpByGroup.set(groupId, empty);
    return empty;
  }

  const chain: GeneratorChain = {
    devices: group.devices,
    groupStateById: context.groupStateById,
  };
  const sceneInstances = buildGroupSceneInstances(groupId, context);
  const evaluated = applyColorProgramsDetailed(
    chain,
    collectSourceNotesForSceneInstances(sceneInstances, context),
    MIN_NOTE_DURATION,
  );
  context.cache.sourceColorGuideWarpByGroup.set(groupId, evaluated.colorGuideWarpByOriginId);
  return evaluated.colorGuideWarpByOriginId;
};

const buildColorGuideWarpForChain = (
  chain: GeneratorChain,
  sceneInstances: ReadonlyArray<SceneInstance>,
  context: GroupEvaluationContext,
): ReadonlyMap<string, ColorGuideWarp> => applyColorProgramsDetailed(
  chain,
  collectSourceNotesForSceneInstances(sceneInstances, context),
  MIN_NOTE_DURATION,
).colorGuideWarpByOriginId;

const buildGuidedPolylinesAtTime = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  sourceTime: number,
  guideWarpByOriginId: ReadonlyMap<string, ColorGuideWarp>,
): Polyline[] => {
  const basePolylines = projectPolylinesAtTime(sceneInstances, sourceTime);
  if (basePolylines.length === 0) {
    return [];
  }

  const originIds = Array.from(new Set(basePolylines.map((polyline) => polyline.originId)));
  const guidedPolylines: Polyline[] = [];
  for (const originId of originIds) {
    const guideBeat = resolveGuideBeat(sourceTime, guideWarpByOriginId.get(originId));
    guidedPolylines.push(
      ...projectPolylinesAtTime(sceneInstances, guideBeat)
        .filter((polyline) => polyline.originId === originId),
    );
  }

  return guidedPolylines;
};

const buildGroupPolylinesForDeviceRange = (
  groupId: GroupId,
  context: GroupEvaluationContext,
  endExclusive: number,
  originWindows?: Map<string, OriginWindow>,
): Polyline[] => {
  const group = context.groupById.get(groupId);
  if (!group) {
    return [];
  }

  const slicedChain: GeneratorChain = {
    devices: group.devices.slice(0, endExclusive),
    groupStateById: context.groupStateById,
  };
  const sceneInstances = buildSceneInstances(slicedChain, context.worldBounds, (effect, deviceIndex) => {
    if (effect.kind !== 'mask') {
      return null;
    }

    const reverseParityAfter = resolveReverseParityAfter(slicedChain, slicedChain.devices);
    const reverseAfter = reverseParityAfter[deviceIndex] === true;
    const timeKind: MaskTimeKind = reverseAfter ? 'reversed' : 'forward';
    return resolveMaskEffectContext(effect, context, timeKind, groupId, deviceIndex);
  });
  return projectPolylinesAtTime(sceneInstances, context.time, originWindows);
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
  originWindows?: Map<string, OriginWindow>,
): Polyline[] => {
  const cached = context.cache.outputPolylinesByGroup.get(groupId);
  if (cached) {
    return cached;
  }

  const sceneInstances = buildOutputGroupSceneInstances(groupId, context);
  const polylines = sceneInstances.length > 0
    ? projectPolylinesAtTime(sceneInstances, context.time, originWindows)
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
  originWindows?: Map<string, OriginWindow>,
): Polyline[] => {
  const polylines: Polyline[] = [];

  for (const group of context.groupChains) {
    polylines.push(...buildOutputGroupPolylinesAtTime(group.id, context, originWindows));
  }

  return polylines;
};

export const evaluateMaskDebugSnapshot = (
  maskDeviceId: string,
  context: GroupEvaluationContext,
  originWindows?: Map<string, OriginWindow>,
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
      sourceId,
      timeKind,
      sourcePolylines,
      sourceActiveTiles: maskDevice.params.sourceKind === 'group' && sourceId
        ? resolveGroupSourceActiveTiles(sourceId, context, timeKind, group.id, maskIndex)
        : (maskDevice.params.sourceKind === 'generator' && sourceId
          ? resolveGeneratorSourceActiveTiles(sourceId, context, timeKind, group.id, maskIndex)
          : new Set()),
      consumerPolylinesBeforeMask: buildGroupPolylinesForDeviceRange(group.id, context, maskIndex, originWindows),
      consumerPolylinesAfterMask: buildOutputGroupPolylinesAtTime(group.id, context, originWindows),
    };
  }

  return null;
};
