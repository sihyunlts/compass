import type { Bounds, GeneratorLayer } from '../core-types';
import type { RotateEffectNode } from '../../shared/types';
import { COMPOSITION_CENTER, toRotateTransformAt } from '../geometry';
import { applySpatialTransformToLayer } from '../layer-utils';

export const applyRotateEffect = (
  layers: ReadonlyArray<GeneratorLayer>,
  effect: RotateEffectNode,
  worldBounds: Bounds,
): GeneratorLayer[] => {
  const transform = toRotateTransformAt(effect.params.angleDeg, COMPOSITION_CENTER);
  const next: GeneratorLayer[] = [];
  for (const layer of layers) {
    const transformed = applySpatialTransformToLayer(layer, transform, worldBounds);
    if (transformed) {
      next.push(transformed);
    }
  }
  return next;
};
