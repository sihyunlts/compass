import type { Bounds, SceneInstance } from '../core-types';
import type { ScaleEffectNode } from '../../shared/model';
import { toScaleTransformAt } from '../geometry';
import { applySpatialTransformToSceneInstances } from '../scene-operators/spatial';

export const applyScaleEffect = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  effect: ScaleEffectNode,
  worldBounds: Bounds,
): SceneInstance[] => {
  const transform = toScaleTransformAt(
    effect.params.scaleX,
    effect.params.scaleY,
    { x: effect.params.centerX, y: effect.params.centerY },
  );
  if (!transform) {
    return sceneInstances.slice();
  }

  return applySpatialTransformToSceneInstances(sceneInstances, transform, worldBounds);
};
