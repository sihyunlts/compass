import type { SceneInstance } from '../core-types';
import { trimSceneInstancesTemporally } from '../scene-operators/temporal';

export const applyTrimEffect = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  start: number,
  end: number,
): SceneInstance[] => trimSceneInstancesTemporally(sceneInstances, start, end);
