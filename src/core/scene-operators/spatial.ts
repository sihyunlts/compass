import type { AffineTransform, Bounds, SceneInstance } from '../core-types';
import { composeAffine, invertAffine, mapBoundsThroughAffine } from '../geometry';

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

export const applySpatialTransformToSceneInstances = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  transform: AffineTransform,
  worldBounds: Bounds,
): SceneInstance[] => {
  const next: SceneInstance[] = [];

  for (const sceneInstance of sceneInstances) {
    const transformed = applySpatialTransformToSceneInstance(sceneInstance, transform, worldBounds);
    if (transformed) {
      next.push(transformed);
    }
  }

  return next;
};
