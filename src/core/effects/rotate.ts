import type { Bounds, SceneInstance } from '../core-types';
import type { RotateEffectNode } from '../../shared/model';
import { COMPOSITION_CENTER, toRotateTransformAt } from '../geometry';
import { applySpatialTransformToSceneInstance } from '../layer-utils';

export const applyRotateEffect = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  effect: RotateEffectNode,
  worldBounds: Bounds,
): SceneInstance[] => {
  const transform = toRotateTransformAt(effect.params.angleDeg, COMPOSITION_CENTER);
  const next: SceneInstance[] = [];
  for (const sceneInstance of sceneInstances) {
    const transformed = applySpatialTransformToSceneInstance(sceneInstance, transform, worldBounds);
    if (transformed) {
      next.push(transformed);
    }
  }
  return next;
};
