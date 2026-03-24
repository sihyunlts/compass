import type { AffineTransform, Bounds, ClipShape, SceneInstance } from './core-types';
import {
  IDENTITY_AFFINE,
  composeAffine,
  invertAffine,
  mapBoundsThroughAffine,
} from './geometry';

export const applySpatialTransformToSceneInstance = (
  sceneInstance: SceneInstance,
  transform: AffineTransform,
  worldBounds: Bounds,
): SceneInstance | null => {
  const nextSpatial = composeAffine(transform, sceneInstance.spatial);
  const nextInverse = invertAffine(nextSpatial);
  if (!nextInverse) {
    return null;
  }

  const inverseTransform = invertAffine(transform);
  if (!inverseTransform) {
    return null;
  }

  return {
    ...sceneInstance,
    spatial: nextSpatial,
    inverseSpatial: nextInverse,
    sourceBounds: mapBoundsThroughAffine(worldBounds, nextInverse),
    clipStack: sceneInstance.clipStack.map((clip) => ({
      ...clip,
      inverseTransform: composeAffine(clip.inverseTransform, inverseTransform),
    })),
  };
};

export const appendClipToSceneInstance = (
  sceneInstance: SceneInstance,
  shape: ClipShape,
): SceneInstance => ({
  ...sceneInstance,
  clipStack: [
    ...sceneInstance.clipStack,
    {
      shape,
      inverseTransform: IDENTITY_AFFINE,
    },
  ],
});

export const applyReverseTemporalToSceneInstance = (sceneInstance: SceneInstance): SceneInstance => ({
  ...sceneInstance,
  temporal: {
    alpha: -sceneInstance.temporal.alpha,
    beta: 1 - sceneInstance.temporal.beta,
  },
});
