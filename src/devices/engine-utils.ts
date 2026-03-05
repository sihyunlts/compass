import type { Bounds, GeneratorLayerBase } from '../core/core-types';
import { IDENTITY_AFFINE, mapBoundsThroughAffine } from '../core/geometry';

export const createGeneratorLayerBase = (
  originId: string,
  worldBounds: Bounds,
): Omit<GeneratorLayerBase, 'velocity'> => {
  const inverseSpatial = IDENTITY_AFFINE;

  return {
    originId,
    spatial: IDENTITY_AFFINE,
    inverseSpatial,
    sourceBounds: mapBoundsThroughAffine(worldBounds, inverseSpatial),
    temporal: { alpha: 1, beta: 0 },
  };
};

export const resolveLayerLocalTime = (
  layer: Pick<GeneratorLayerBase, 'temporal'>,
  t01: number,
): number | null => {
  if (!Number.isFinite(t01)) {
    return null;
  }

  const localT = layer.temporal.alpha * t01 + layer.temporal.beta;
  if (!Number.isFinite(localT) || localT < 0 || localT > 1) {
    return null;
  }

  return localT;
};
