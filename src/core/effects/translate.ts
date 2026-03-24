import type { Bounds, SceneInstance } from '../core-types';
import type { TranslateEffectNode } from '../../shared/model';
import { toTranslationTransform } from '../geometry';
import { applySpatialTransformToSceneInstances } from '../scene-operators/spatial';

export const applyTranslateEffect = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  effect: TranslateEffectNode,
  worldBounds: Bounds,
): SceneInstance[] => applySpatialTransformToSceneInstances(
  sceneInstances,
  toTranslationTransform(effect.params.offsetX, effect.params.offsetY),
  worldBounds,
);
