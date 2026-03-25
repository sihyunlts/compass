import type { SceneInstance, TemporalVisibilityWindow } from '../core-types';
import {
  createSampledRemapFromTimeWarpCurve,
  isIdentityTimeWarpCurve,
} from '../timewarp/curve';
import { NORMALIZED_TIMELINE_WINDOW, transformSceneInstancesTemporally } from '../scene-operators/temporal';
import type { EffectApplicationContext } from '../../devices/engine-types';
import type { TimeWarpCurve } from '../../shared/model';

const mapSampleToSourceWindow = (
  sample: number | null,
  sourceWindow: TemporalVisibilityWindow,
): number | null => {
  if (sample === null || !Number.isFinite(sample)) {
    return null;
  }

  const sourceSpan = sourceWindow.end - sourceWindow.start;
  if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
    return null;
  }

  return sourceWindow.start + sourceSpan * sample;
};

const resolveTimeWarpWindows = (
  sceneInstance: SceneInstance,
  context: Pick<EffectApplicationContext, 'sourceTemporalWindowByOriginId'>,
): {
  inputWindow: TemporalVisibilityWindow;
  outputWindow: TemporalVisibilityWindow;
} => {
  if (sceneInstance.temporal.hasAuthoredTimeline) {
    const authoredWindow = sceneInstance.temporal.visibilityWindow;
    return {
      inputWindow: authoredWindow,
      outputWindow: authoredWindow,
    };
  }

  return {
    inputWindow: context.sourceTemporalWindowByOriginId?.get(sceneInstance.originId) ?? NORMALIZED_TIMELINE_WINDOW,
    outputWindow: NORMALIZED_TIMELINE_WINDOW,
  };
};

export const applyTimeWarpEffect = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  curve: TimeWarpCurve,
  context: Pick<EffectApplicationContext, 'sourceTemporalWindowByOriginId'>,
): SceneInstance[] => {
  if (isIdentityTimeWarpCurve(curve)) {
    return sceneInstances.map((sceneInstance) => ({ ...sceneInstance }));
  }

  const remap = createSampledRemapFromTimeWarpCurve(curve);

  return sceneInstances.map((sceneInstance) => {
    const { inputWindow, outputWindow } = resolveTimeWarpWindows(sceneInstance, context);
    const sourceSpan = inputWindow.end - inputWindow.start;
    const outputSpan = outputWindow.end - outputWindow.start;
    if (!Number.isFinite(sourceSpan) || sourceSpan <= 0 || !Number.isFinite(outputSpan) || outputSpan <= 0) {
      return { ...sceneInstance };
    }

    return transformSceneInstancesTemporally([sceneInstance], {
      remapToInput: {
        kind: 'sampled',
        domainStart: outputWindow.start,
        domainEnd: outputWindow.end,
        samples: remap.samples.map((sample) => mapSampleToSourceWindow(sample, inputWindow)),
      },
      visibilityWindow: outputWindow,
      marksAuthoredTimeline: true,
    })[0] ?? { ...sceneInstance };
  });
};
