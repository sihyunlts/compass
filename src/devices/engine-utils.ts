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
    temporal: {
      remap: { alpha: 1, beta: 0 },
      visibilityWindow: { start: 0, end: 1 },
      hasAuthoredTimeline: false,
    },
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

  const { visibilityWindow, remap } = sceneInstance.temporal;
  if (t01 < visibilityWindow.start || t01 > visibilityWindow.end) {
    return null;
  }

  const localT = remap.alpha * t01 + remap.beta;
  if (!Number.isFinite(localT) || localT < 0 || localT > 1) {
    return null;
  }

  return localT;
};

export const isSceneInstanceVisibleAtTime = (
  sceneInstance: Pick<SceneInstanceBase, 'temporal'>,
  t01: number,
): boolean => {
  if (!Number.isFinite(t01)) {
    return false;
  }

  const { visibilityWindow } = sceneInstance.temporal;
  return t01 >= visibilityWindow.start && t01 <= visibilityWindow.end;
};
