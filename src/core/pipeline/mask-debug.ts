import type { MaskEffectNode } from '../../shared/model';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type { Polyline, SceneInstance } from '../core-types';
import { projectSceneToPolylinesAtTime } from './scene-projection';
import type {
  GroupEvaluationContext,
  GroupId,
  MaskTimeKind,
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

interface MaskDebugDependencies {
  resolveScopedReverseParityAfter: (chain: GroupEvaluationContext['chain'], targetGroupId: GroupId) => boolean[];
  resolveGroupSourcePolylines: (
    groupId: GroupId,
    context: GroupEvaluationContext,
    timeKind: MaskTimeKind,
    consumingDeviceIndex?: number,
  ) => Polyline[];
  resolveGeneratorSourcePolylines: (
    generatorId: string,
    context: GroupEvaluationContext,
    timeKind: MaskTimeKind,
    consumingDeviceIndex?: number,
  ) => Polyline[];
  resolveGroupSourceTiles: (
    sourceDomain: MaskEffectNode['params']['sourceDomain'],
    groupId: GroupId,
    context: GroupEvaluationContext,
    timeKind: MaskTimeKind,
    consumingDeviceIndex?: number,
  ) => Set<number>;
  resolveGeneratorSourceTiles: (
    sourceDomain: MaskEffectNode['params']['sourceDomain'],
    generatorId: string,
    context: GroupEvaluationContext,
    timeKind: MaskTimeKind,
    consumingDeviceIndex?: number,
  ) => Set<number>;
  resolveCheckpointSceneInstances: (
    context: GroupEvaluationContext,
    endExclusive: number,
  ) => SceneInstance[];
  buildOriginIdsForGroup: (
    groupId: GroupId,
    context: GroupEvaluationContext,
  ) => ReadonlySet<string>;
  filterSceneInstancesByOriginIds: (
    sceneInstances: ReadonlyArray<SceneInstance>,
    originIds: ReadonlySet<string>,
  ) => SceneInstance[];
  buildOutputGroupPolylinesAtTime: (
    groupId: GroupId,
    context: GroupEvaluationContext,
  ) => Polyline[];
}

export const evaluateMaskDebugSnapshot = (
  maskDeviceId: string,
  context: GroupEvaluationContext,
  dependencies: MaskDebugDependencies,
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

    const globalMaskIndex = context.chain.devices.findIndex((device) => device.id === maskDeviceId);
    if (globalMaskIndex < 0) {
      return null;
    }

    const reverseParityAfter = dependencies.resolveScopedReverseParityAfter(context.chain, group.id);
    const timeKind: MaskTimeKind = reverseParityAfter[globalMaskIndex] === true ? 'reversed' : 'forward';

    let sourcePolylines: Polyline[] = [];
    const sourceId = normalizeOptionalId(maskDevice.params.sourceId);
    if (maskDevice.params.sourceKind === 'group' && sourceId) {
      sourcePolylines = dependencies.resolveGroupSourcePolylines(
        sourceId,
        context,
        timeKind,
        globalMaskIndex,
      );
    } else if (maskDevice.params.sourceKind === 'generator' && sourceId) {
      sourcePolylines = dependencies.resolveGeneratorSourcePolylines(
        sourceId,
        context,
        timeKind,
        globalMaskIndex,
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
        ? dependencies.resolveGroupSourceTiles(
          maskDevice.params.sourceDomain,
          sourceId,
          context,
          timeKind,
          globalMaskIndex,
        )
        : (maskDevice.params.sourceKind === 'generator' && sourceId
          ? dependencies.resolveGeneratorSourceTiles(
            maskDevice.params.sourceDomain,
            sourceId,
            context,
            timeKind,
            globalMaskIndex,
          )
          : new Set()),
      consumerPolylinesBeforeMask: projectSceneToPolylinesAtTime(
        dependencies.filterSceneInstancesByOriginIds(
          dependencies.resolveCheckpointSceneInstances(context, globalMaskIndex),
          dependencies.buildOriginIdsForGroup(group.id, context),
        ),
        context.time,
      ),
      consumerPolylinesAfterMask: dependencies.buildOutputGroupPolylinesAtTime(group.id, context),
    };
  }

  return null;
};
