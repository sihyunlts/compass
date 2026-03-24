import type { Bounds, SceneInstance } from '../core-types';
import type { MirrorEffectNode } from '../../shared/model';
import { COMPOSITION_CENTER, toMirrorTransformAt } from '../geometry';
import { applySpatialTransformToSceneInstances } from '../scene-operators/spatial';

export const applyMirrorEffect = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  effect: MirrorEffectNode,
  worldBounds: Bounds,
): SceneInstance[] => applySpatialTransformToSceneInstances(
  sceneInstances,
  toMirrorTransformAt(effect.params.angleDeg, COMPOSITION_CENTER),
  worldBounds,
);
