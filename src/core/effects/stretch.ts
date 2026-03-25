import type { SceneInstance } from '../core-types';
import { stretchSceneInstancesTemporally } from '../scene-operators/temporal';
import type { EffectApplicationContext } from '../../devices/engine-types';

export const applyStretchEffect = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  start: number,
  end: number,
  context: Pick<EffectApplicationContext, 'sourceTemporalWindowByOriginId'>,
): SceneInstance[] => stretchSceneInstancesTemporally(
  sceneInstances,
  start,
  end,
  context.sourceTemporalWindowByOriginId,
);
