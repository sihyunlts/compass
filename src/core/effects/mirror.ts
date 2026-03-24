import type { Bounds, SceneInstance } from '../core-types';
import type { MirrorEffectNode } from '../../shared/model';
import { COMPOSITION_CENTER, toMirrorTransformAt } from '../geometry';
import { applySpatialTransformToSceneInstance } from '../layer-utils';

export const applyMirrorEffect = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  effect: MirrorEffectNode,
  worldBounds: Bounds,
): SceneInstance[] => {
  const transform = toMirrorTransformAt(effect.params.angleDeg, COMPOSITION_CENTER);
  const next: SceneInstance[] = [];
  for (const sceneInstance of sceneInstances) {
    const transformed = applySpatialTransformToSceneInstance(sceneInstance, transform, worldBounds);
    if (transformed) {
      next.push(transformed);
    }
  }
  return next;
};
