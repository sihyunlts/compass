import type { SceneInstance } from '../core-types';
import { reverseSceneInstancesTemporally } from '../scene-operators/temporal';

export const applyReverseEffect = (
  sceneInstances: ReadonlyArray<SceneInstance>,
): SceneInstance[] => reverseSceneInstancesTemporally(sceneInstances);
