import type { Bounds, SceneInstance } from '../core-types';
import type { SymmetryEffectNode } from '../../shared/model';
import { applySymmetryToSceneInstances } from '../scene-operators/symmetry';

export const applySymmetryEffect = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  effect: SymmetryEffectNode,
  worldBounds: Bounds,
): SceneInstance[] => applySymmetryToSceneInstances(sceneInstances, effect, worldBounds);
