import { doesDeviceToggleTimelineParity } from '../../devices/engine';
import type { GeneratorChain } from '../../shared/model';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type { Polyline, SceneInstance } from '../core-types';
import { buildSceneInstances } from './layers';
import { evaluateMaskDebugSnapshot as evaluateMaskDebugSnapshotImpl, type MaskDebugSnapshot } from './mask-debug';
import { createMaskSourceOutputResolver } from './mask-source-output';
import { createMaskSourceResolvers } from './mask-source-resolution';
import { projectSceneToPolylinesAtTime } from './scene-projection';
import { isGeneratorNode } from './groups';
import type {
  GroupEvaluationContext,
  GroupId,
  MaskTimeKind,
} from './types';

const resolveScopedReverseParityAfter = (
  chain: GeneratorChain,
  targetGroupId: GroupId,
): boolean[] => {
  const parityAfter: boolean[] = new Array(chain.devices.length).fill(false);
  let parity = false;

  for (let index = chain.devices.length - 1; index >= 0; index -= 1) {
    parityAfter[index] = parity;
    const device = chain.devices[index];
    const deviceGroupId = normalizeOptionalId(device.groupId);
    const affectsTarget = deviceGroupId === null || deviceGroupId === targetGroupId;
    if (
      affectsTarget
      && doesDeviceToggleTimelineParity(device)
      && isDeviceEffectivelyEnabled(chain, device)
    ) {
      parity = !parity;
    }
  }

  return parityAfter;
};

const resolveScopedMaskTimeKind = (
  chain: GeneratorChain,
  targetGroupId: GroupId,
  deviceIndex: number,
): MaskTimeKind => {
  const reverseParityAfter = resolveScopedReverseParityAfter(chain, targetGroupId);
  return reverseParityAfter[deviceIndex] === true ? 'reversed' : 'forward';
};

const buildOriginIdsForGroup = (
  groupId: GroupId,
  context: GroupEvaluationContext,
): Set<string> => {
  const group = context.groupById.get(groupId);
  if (!group) {
    return new Set();
  }

  return new Set(
    group.devices
      .filter((device) => isGeneratorNode(device))
      .map((device) => device.id),
  );
};

const filterSceneInstancesByOriginIds = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  originIds: ReadonlySet<string>,
): SceneInstance[] => sceneInstances.filter((sceneInstance) => originIds.has(sceneInstance.originId));

const buildSceneInstancesForChain = (
  chain: GeneratorChain,
  context: GroupEvaluationContext,
): SceneInstance[] => buildSceneInstances(
  chain,
  context.worldBounds,
  (effect, deviceIndex) => {
    if (effect.kind !== 'mask') {
      return null;
    }

    return maskSourceResolvers.resolveMaskEffectContext(
      effect,
      context,
      resolveScopedMaskTimeKind(chain, normalizeOptionalId(effect.groupId), deviceIndex),
      deviceIndex,
    );
  },
);

const buildFinalSceneInstances = (
  context: GroupEvaluationContext,
): SceneInstance[] => {
  if (context.cache.finalSceneInstances) {
    return context.cache.finalSceneInstances;
  }

  const sceneInstances = buildSceneInstancesForChain(context.chain, context);
  context.cache.finalSceneInstances = sceneInstances;
  return sceneInstances;
};

const buildCheckpointSceneInstances = (
  context: GroupEvaluationContext,
  endExclusive: number,
): SceneInstance[] => {
  const cached = context.cache.checkpointSceneInstancesByIndex.get(endExclusive);
  if (cached) {
    return cached;
  }

  const slicedChain: GeneratorChain = {
    devices: context.chain.devices.slice(0, endExclusive),
    groupStateById: context.groupStateById,
  };
  const sceneInstances = buildSceneInstancesForChain(slicedChain, context);
  context.cache.checkpointSceneInstancesByIndex.set(endExclusive, sceneInstances);
  return sceneInstances;
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

  const sceneInstances = filterSceneInstancesByOriginIds(
    buildFinalSceneInstances(context),
    buildOriginIdsForGroup(groupId, context),
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
    ? projectSceneToPolylinesAtTime(sceneInstances, context.time)
    : [];
  context.cache.outputPolylinesByGroup.set(groupId, polylines);
  return polylines;
};

const resolveGroupSourceOutputActiveTiles = createMaskSourceOutputResolver({
  resolveOutputGroupSceneInstances: buildOutputGroupSceneInstances,
});

const maskSourceResolvers = createMaskSourceResolvers({
  resolveFinalSceneInstances: buildFinalSceneInstances,
  resolveCheckpointSceneInstances: buildCheckpointSceneInstances,
  buildOriginIdsForGroup,
  filterSceneInstancesByOriginIds,
  resolveGroupSourceOutputActiveTiles,
});

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
): MaskDebugSnapshot | null => evaluateMaskDebugSnapshotImpl(maskDeviceId, context, {
  resolveScopedReverseParityAfter,
  resolveGroupSourcePolylines: maskSourceResolvers.resolveGroupSourcePolylines,
  resolveGeneratorSourcePolylines: maskSourceResolvers.resolveGeneratorSourcePolylines,
  resolveGroupSourceTiles: maskSourceResolvers.resolveGroupSourceTiles,
  resolveGeneratorSourceTiles: maskSourceResolvers.resolveGeneratorSourceTiles,
  resolveCheckpointSceneInstances: buildCheckpointSceneInstances,
  buildOriginIdsForGroup,
  filterSceneInstancesByOriginIds,
  buildOutputGroupPolylinesAtTime,
});

export type { MaskDebugSnapshot } from './mask-debug';
