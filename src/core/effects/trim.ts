import type { SceneInstance } from '../core-types';
import { trimSceneInstancesTemporally } from '../scene-operators/temporal';
import type { EffectApplicationContext } from '../../devices/engine-types';

export const applyTrimEffect = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  start: number,
  end: number,
  context: Pick<EffectApplicationContext, 'sourceTemporalWindowByOriginId'>,
): SceneInstance[] => trimSceneInstancesTemporally(
  sceneInstances,
  start,
  end,
  context.sourceTemporalWindowByOriginId,
);
