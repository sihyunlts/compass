import type { SceneInstance } from '../core-types';
import { applyReverseTemporalToSceneInstance } from '../layer-utils';

export const applyReverseEffect = (
  sceneInstances: ReadonlyArray<SceneInstance>,
): SceneInstance[] => sceneInstances.map((sceneInstance) => applyReverseTemporalToSceneInstance(sceneInstance));
