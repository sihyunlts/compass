import type { SceneInstance } from '../core-types';
import { stretchSceneInstancesTemporally } from '../scene-operators/temporal';

export const applyStretchEffect = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  start: number,
  end: number,
): SceneInstance[] => stretchSceneInstancesTemporally(sceneInstances, start, end);
