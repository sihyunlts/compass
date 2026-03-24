import type { SceneInstance } from '../core-types';

export const reverseSceneInstancesTemporally = (
  sceneInstances: ReadonlyArray<SceneInstance>,
): SceneInstance[] => sceneInstances.map((sceneInstance) => ({
  ...sceneInstance,
  temporal: {
    alpha: -sceneInstance.temporal.alpha,
    beta: 1 - sceneInstance.temporal.beta,
  },
}));
