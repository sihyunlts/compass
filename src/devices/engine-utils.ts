import type { Bounds, SceneInstanceBase } from '../core/core-types';
import { IDENTITY_AFFINE, mapBoundsThroughAffine } from '../core/geometry';
import { resolveSceneTemporalInputTime } from '../core/scene-operators/temporal';
import { normalizeOptionalId } from '../shared/normalize-id';

export const createSceneInstanceBase = (
  originId: string,
  originGroupId: string | null | undefined,
  worldBounds: Bounds,
): Omit<SceneInstanceBase, 'primitive' | 'velocity'> => {
  const inverseSpatial = IDENTITY_AFFINE;

  return {
    originId,
    originGroupId: normalizeOptionalId(originGroupId),
    spatial: IDENTITY_AFFINE,
    inverseSpatial,
    sourceBounds: mapBoundsThroughAffine(worldBounds, inverseSpatial),
    temporal: {
      remap: { kind: 'affine', alpha: 1, beta: 0 },
      visibilityWindow: { start: 0, end: 1 },
      hasAuthoredTimeline: false,
    },
    clipStack: [],
  };
};

export const resolveSceneLocalTime = (
  sceneInstance: Pick<SceneInstanceBase, 'temporal'>,
  t01: number,
): number | null => resolveSceneTemporalInputTime(sceneInstance.temporal, t01);

export const isSceneInstanceVisibleAtTime = (
  sceneInstance: Pick<SceneInstanceBase, 'temporal'>,
  t01: number,
): boolean => resolveSceneTemporalInputTime(sceneInstance.temporal, t01) !== null;
