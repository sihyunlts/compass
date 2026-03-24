import type { Bounds, SceneInstanceBase } from '../core/core-types';
import { IDENTITY_AFFINE, mapBoundsThroughAffine } from '../core/geometry';
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
    temporal: { alpha: 1, beta: 0 },
    clipStack: [],
  };
};

export const resolveSceneLocalTime = (
  sceneInstance: Pick<SceneInstanceBase, 'temporal'>,
  t01: number,
): number | null => {
  if (!Number.isFinite(t01)) {
    return null;
  }

  const localT = sceneInstance.temporal.alpha * t01 + sceneInstance.temporal.beta;
  if (!Number.isFinite(localT) || localT < 0 || localT > 1) {
    return null;
  }

  return localT;
};
