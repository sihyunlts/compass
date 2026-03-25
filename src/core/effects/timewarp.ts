import type { SceneInstance } from '../core-types';
import { createSampledRemapFromTimeWarpCurve } from '../timewarp/curve';
import { NORMALIZED_TIMELINE_WINDOW, transformSceneInstancesTemporally } from '../scene-operators/temporal';
import type { TimeWarpCurve } from '../../shared/model';

export const applyTimeWarpEffect = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  curve: TimeWarpCurve,
): SceneInstance[] => transformSceneInstancesTemporally(sceneInstances, {
  remapToInput: createSampledRemapFromTimeWarpCurve(curve),
  visibilityWindow: NORMALIZED_TIMELINE_WINDOW,
  marksAuthoredTimeline: true,
});
