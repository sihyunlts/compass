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
    const sourceWindow = sceneInstance.temporal.hasAuthoredTimeline
      ? NORMALIZED_TIMELINE_WINDOW
      : context.sourceTemporalWindowByOriginId?.get(sceneInstance.originId) ?? NORMALIZED_TIMELINE_WINDOW;
    const sourceSpan = sourceWindow.end - sourceWindow.start;
    if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
      return { ...sceneInstance };
    }

    return transformSceneInstancesTemporally([sceneInstance], {
      remapToInput: remap.kind === 'sampled'
        ? {
            kind: 'sampled',
            domainStart: remap.domainStart,
            domainEnd: remap.domainEnd,
            samples: remap.samples.map((sample) => mapSampleToSourceWindow(sample, sourceWindow)),
          }
        : {
            kind: 'affine',
            alpha: remap.alpha * sourceSpan,
            beta: sourceWindow.start + sourceSpan * remap.beta,
          },
      visibilityWindow: NORMALIZED_TIMELINE_WINDOW,
      marksAuthoredTimeline: true,
    })[0] ?? { ...sceneInstance };
  });
};
