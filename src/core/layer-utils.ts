import type { AffineTransform, Bounds, GeneratorLayer, Mask } from './core-types';
import { applyAffine, combineMasks, composeAffine, invertAffine, mapBoundsThroughAffine } from './geometry';

export const applySpatialTransformToLayer = (
  layer: GeneratorLayer,
  transform: AffineTransform,
  worldBounds: Bounds,
): GeneratorLayer | null => {
  const nextSpatial = composeAffine(transform, layer.spatial);
  const nextInverse = invertAffine(nextSpatial);
  if (!nextInverse) {
    return null;
  }

  const inverseTransform = invertAffine(transform);
  const nextMask: Mask | undefined = inverseTransform && layer.mask
    ? (x, y) => {
      const point = applyAffine(inverseTransform, { x, y });
      return layer.mask ? layer.mask(point.x, point.y) : true;
    }
    : layer.mask;

  return {
    ...layer,
    spatial: nextSpatial,
    inverseSpatial: nextInverse,
    sourceBounds: mapBoundsThroughAffine(worldBounds, nextInverse),
    mask: nextMask,
  };
};

export const applyMaskToLayer = (layer: GeneratorLayer, mask: Mask): GeneratorLayer => ({
  ...layer,
  mask: combineMasks(layer.mask, mask),
});

export const applyReverseTemporalToLayer = (layer: GeneratorLayer): GeneratorLayer => ({
  ...layer,
  temporal: {
    alpha: -layer.temporal.alpha,
    beta: 1 - layer.temporal.beta,
  },
});
