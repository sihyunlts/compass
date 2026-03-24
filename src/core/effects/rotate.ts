import type { Bounds, SceneInstance } from '../core-types';
import type { RotateEffectNode } from '../../shared/model';
import { COMPOSITION_CENTER, toRotateTransformAt } from '../geometry';
import { applySpatialTransformToSceneInstances } from '../scene-operators/spatial';

export const applyRotateEffect = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  effect: RotateEffectNode,
  worldBounds: Bounds,
): SceneInstance[] => applySpatialTransformToSceneInstances(
  sceneInstances,
  toRotateTransformAt(effect.params.angleDeg, COMPOSITION_CENTER),
  worldBounds,
);
