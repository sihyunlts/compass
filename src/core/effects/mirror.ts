import type { Bounds, GeneratorLayer } from '../core-types';
import type { MirrorEffectNode } from '../../shared/model';
import { COMPOSITION_CENTER, toMirrorTransformAt } from '../geometry';
import { applySpatialTransformToLayer } from '../layer-utils';

export const applyMirrorEffect = (
  layers: ReadonlyArray<GeneratorLayer>,
  effect: MirrorEffectNode,
  worldBounds: Bounds,
): GeneratorLayer[] => {
  const transform = toMirrorTransformAt(effect.params.angleDeg, COMPOSITION_CENTER);
  const next: GeneratorLayer[] = [];
  for (const layer of layers) {
    const transformed = applySpatialTransformToLayer(layer, transform, worldBounds);
    if (transformed) {
      next.push(transformed);
    }
  }
  return next;
};
