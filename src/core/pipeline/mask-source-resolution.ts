import type { MaskEffectNode } from '../../shared/model';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type { Polyline, SceneInstance } from '../core-types';
import {
  projectSceneToActivationFrame,
  resolveActiveTilesFromPolylines,
} from './active';
import { resolveMaskTime } from './groups';
import { projectSceneToPolylinesAtTime } from './scene-projection';
import type {
  GroupEvaluationContext,
  GroupId,
  MaskTimeKind,
} from './types';

interface MaskSourceResolutionDependencies {
  resolveFinalSceneInstances: (context: GroupEvaluationContext) => SceneInstance[];
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
  resolveGroupSourceOutputActiveTiles: (
    sourceGroupId: string,
    context: GroupEvaluationContext,
    timeKind: MaskTimeKind,
    consumingDeviceIndex?: number,
  ) => Set<number>;
}

export const createMaskSourceResolvers = (
  dependencies: MaskSourceResolutionDependencies,
): {
  resolveGroupSourceSceneInstances: (
    groupId: GroupId,
    context: GroupEvaluationContext,
    consumingDeviceIndex?: number,
  ) => SceneInstance[];
  resolveGeneratorSourceSceneInstances: (
    generatorId: string,
    context: GroupEvaluationContext,
    consumingDeviceIndex?: number,
  ) => SceneInstance[];
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
  resolveMaskEffectContext: (
    effect: MaskEffectNode,
    context: GroupEvaluationContext,
    timeKind: MaskTimeKind,
    consumingDeviceIndex: number,
  ) => { tilesOverride?: Iterable<number> | null };
} => {
  const resolveGroupSourceSceneInstances = (
    groupId: GroupId,
    context: GroupEvaluationContext,
    consumingDeviceIndex?: number,
  ): SceneInstance[] => {
    const originIds = dependencies.buildOriginIdsForGroup(groupId, context);
    if (originIds.size === 0) {
      return [];
    }

    const sceneInstances = consumingDeviceIndex !== undefined
      ? dependencies.resolveCheckpointSceneInstances(context, consumingDeviceIndex)
      : dependencies.resolveFinalSceneInstances(context);
    return dependencies.filterSceneInstancesByOriginIds(sceneInstances, originIds);
  };

  const resolveGeneratorSourceSceneInstances = (
    generatorId: string,
    context: GroupEvaluationContext,
    consumingDeviceIndex?: number,
  ): SceneInstance[] => {
    const generator = context.generatorById.get(generatorId);
    if (!generator || !isDeviceEffectivelyEnabled(context.chain, generator)) {
      return [];
    }

    const sceneInstances = consumingDeviceIndex !== undefined
      ? dependencies.resolveCheckpointSceneInstances(context, consumingDeviceIndex)
      : dependencies.resolveFinalSceneInstances(context);
    return sceneInstances.filter((sceneInstance) => sceneInstance.originId === generatorId);
  };

  const resolveGroupSourcePolylines = (
    groupId: GroupId,
    context: GroupEvaluationContext,
    timeKind: MaskTimeKind,
    consumingDeviceIndex?: number,
  ): Polyline[] => projectSceneToPolylinesAtTime(
    resolveGroupSourceSceneInstances(groupId, context, consumingDeviceIndex),
    resolveMaskTime(context, timeKind),
  );

  const resolveGeneratorSourcePolylines = (
    generatorId: string,
    context: GroupEvaluationContext,
    timeKind: MaskTimeKind,
    consumingDeviceIndex?: number,
  ): Polyline[] => projectSceneToPolylinesAtTime(
    resolveGeneratorSourceSceneInstances(generatorId, context, consumingDeviceIndex),
    resolveMaskTime(context, timeKind),
  );

  const resolveGroupSourceActiveTiles = (
    groupId: GroupId,
    context: GroupEvaluationContext,
    timeKind: MaskTimeKind,
    consumingDeviceIndex?: number,
  ): Set<number> => {
    if (!groupId) {
      return new Set();
    }

    return dependencies.resolveGroupSourceOutputActiveTiles(
      groupId,
      context,
      timeKind,
      consumingDeviceIndex,
    );
  };

  const resolveGeneratorSourceActiveTiles = (
    generatorId: string,
    context: GroupEvaluationContext,
    timeKind: MaskTimeKind,
    consumingDeviceIndex?: number,
  ): Set<number> => projectSceneToActivationFrame(
    resolveGeneratorSourceSceneInstances(generatorId, context, consumingDeviceIndex),
    resolveMaskTime(context, timeKind),
    context.buttonIndex,
  ).activeTiles;

  const resolveGroupSourceTiles = (
    sourceDomain: MaskEffectNode['params']['sourceDomain'],
    groupId: GroupId,
    context: GroupEvaluationContext,
    timeKind: MaskTimeKind,
    consumingDeviceIndex?: number,
  ): Set<number> => {
    if (sourceDomain === 'scene') {
      return resolveActiveTilesFromPolylines(
        resolveGroupSourcePolylines(groupId, context, timeKind, consumingDeviceIndex),
      );
    }

    return resolveGroupSourceActiveTiles(groupId, context, timeKind, consumingDeviceIndex);
  };

  const resolveGeneratorSourceTiles = (
    sourceDomain: MaskEffectNode['params']['sourceDomain'],
    generatorId: string,
    context: GroupEvaluationContext,
    timeKind: MaskTimeKind,
    consumingDeviceIndex?: number,
  ): Set<number> => {
    if (sourceDomain === 'scene') {
      return resolveActiveTilesFromPolylines(
        resolveGeneratorSourcePolylines(generatorId, context, timeKind, consumingDeviceIndex),
      );
    }

    return resolveGeneratorSourceActiveTiles(generatorId, context, timeKind, consumingDeviceIndex);
  };

  const resolveMaskEffectContext = (
    effect: MaskEffectNode,
    context: GroupEvaluationContext,
    timeKind: MaskTimeKind,
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
          consumingDeviceIndex,
        ),
      };
    }

    return {
      tilesOverride: effect.params.tiles,
    };
  };

  return {
    resolveGroupSourceSceneInstances,
    resolveGeneratorSourceSceneInstances,
    resolveGroupSourcePolylines,
    resolveGeneratorSourcePolylines,
    resolveGroupSourceTiles,
    resolveGeneratorSourceTiles,
    resolveMaskEffectContext,
  };
};
