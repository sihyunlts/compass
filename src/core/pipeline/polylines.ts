import { buildGeneratorPolyline } from '../../devices/engine';
import type { GeneratorChain, MaskEffectNode } from '../../shared/model';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type { Polyline, SceneInstance } from '../core-types';
import { applyTransformToPolyline } from '../geometry';
import {
  projectSceneToActivationFrame,
  resolveActiveTilesFromPolylines,
} from './active';
import { POLYLINE_STEP } from './constants';
import { resolveMaskTime } from './groups';
import {
  buildSceneInstances,
  createSceneInstanceFromNode,
  resolveReverseParityAfter,
} from './layers';
import type {
  GroupEvaluationContext,
  GroupId,
  MaskTimeKind,
  OriginWindow,
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
  originWindows?: Map<string, OriginWindow>,
): Polyline[] => {
  const polylines: Polyline[] = [];

  for (const sceneInstance of sceneInstances) {
    const fitTime = getOriginFitTime(time, originWindows?.get(sceneInstance.originId));
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
): Set<number> => projectSceneToActivationFrame(
  resolveGroupSourceSceneInstances(
    groupId,
    context,
    consumingGroupId,
    consumingDeviceIndex,
  ),
  resolveMaskTime(context, timeKind),
  context.buttonIndex,
).activeTiles;

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
      context.buttonIndex,
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
      context.buttonIndex,
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
        originWindows,
      ),
      consumerPolylinesAfterMask: buildOutputGroupPolylinesAtTime(group.id, context, originWindows),
    };
  }

  return null;
};
