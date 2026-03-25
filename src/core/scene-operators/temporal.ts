import type {
  SceneInstance,
  SceneTemporalState,
  TemporalAffineRemap,
  TemporalVisibilityWindow,
} from '../core-types';

export interface TemporalTransform {
  remapToInput: TemporalAffineRemap;
  visibilityWindow: TemporalVisibilityWindow;
  marksAuthoredTimeline?: boolean;
}

const NORMALIZED_TIMELINE_WINDOW: TemporalVisibilityWindow = {
  start: 0,
  end: 1,
};

const EMPTY_VISIBILITY_WINDOW: TemporalVisibilityWindow = {
  start: 1,
  end: 0,
};

const intersectVisibilityWindows = (
  left: TemporalVisibilityWindow,
  right: TemporalVisibilityWindow,
): TemporalVisibilityWindow => ({
  start: Math.max(left.start, right.start),
  end: Math.min(left.end, right.end),
});

const isTimeVisibleInWindow = (
  visibilityWindow: TemporalVisibilityWindow,
  t01: number,
): boolean => t01 >= visibilityWindow.start && t01 <= visibilityWindow.end;

const resolveVisibilityPreimage = (
  visibilityWindow: TemporalVisibilityWindow,
  remapToInput: TemporalAffineRemap,
): TemporalVisibilityWindow => {
  const mappedStart = (visibilityWindow.start - remapToInput.beta) / remapToInput.alpha;
  const mappedEnd = (visibilityWindow.end - remapToInput.beta) / remapToInput.alpha;

  return {
    start: Math.min(mappedStart, mappedEnd),
    end: Math.max(mappedStart, mappedEnd),
  };
};

const resolveComposedVisibilityWindow = (
  sceneTemporal: SceneTemporalState,
  transform: TemporalTransform,
): TemporalVisibilityWindow => {
  if (transform.remapToInput.alpha === 0) {
    return isTimeVisibleInWindow(sceneTemporal.visibilityWindow, transform.remapToInput.beta)
      ? transform.visibilityWindow
      : EMPTY_VISIBILITY_WINDOW;
  }

  return intersectVisibilityWindows(
    transform.visibilityWindow,
    resolveVisibilityPreimage(sceneTemporal.visibilityWindow, transform.remapToInput),
  );
};

export const composeSceneTemporalState = (
  sceneTemporal: SceneTemporalState,
  transform: TemporalTransform,
): SceneTemporalState => ({
  remap: {
    alpha: sceneTemporal.remap.alpha * transform.remapToInput.alpha,
    beta: sceneTemporal.remap.alpha * transform.remapToInput.beta + sceneTemporal.remap.beta,
  },
  visibilityWindow: resolveComposedVisibilityWindow(sceneTemporal, transform),
  hasAuthoredTimeline: sceneTemporal.hasAuthoredTimeline || transform.marksAuthoredTimeline === true,
});

export const transformSceneInstancesTemporally = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  transform: TemporalTransform,
): SceneInstance[] => sceneInstances.map((sceneInstance) => ({
  ...sceneInstance,
  temporal: composeSceneTemporalState(sceneInstance.temporal, transform),
}));

export const isNonWrapping01TemporalWindow = (
  start: number,
  end: number,
): boolean => (
  Number.isFinite(start)
  && Number.isFinite(end)
  && start >= 0
  && end <= 1
  && end > start
);

export const isIdentity01TemporalWindow = (
  start: number,
  end: number,
): boolean => isNonWrapping01TemporalWindow(start, end) && start === 0 && end === 1;

const resolveSceneInstanceTemporalSourceWindow = (
  sceneInstance: SceneInstance,
  sourceTemporalWindowByOriginId: ReadonlyMap<string, TemporalVisibilityWindow> | undefined,
): TemporalVisibilityWindow => {
  if (sceneInstance.temporal.hasAuthoredTimeline) {
    return NORMALIZED_TIMELINE_WINDOW;
  }

  return sourceTemporalWindowByOriginId?.get(sceneInstance.originId) ?? NORMALIZED_TIMELINE_WINDOW;
};

export const stretchSceneInstancesTemporally = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  start: number,
  end: number,
  sourceTemporalWindowByOriginId?: ReadonlyMap<string, TemporalVisibilityWindow>,
): SceneInstance[] => {
  if (!isNonWrapping01TemporalWindow(start, end)) {
    return [];
  }

  if (isIdentity01TemporalWindow(start, end)) {
    return sceneInstances.map((sceneInstance) => ({ ...sceneInstance }));
  }

  return sceneInstances.map((sceneInstance) => {
    const sourceWindow = resolveSceneInstanceTemporalSourceWindow(
      sceneInstance,
      sourceTemporalWindowByOriginId,
    );
    const sourceSpan = sourceWindow.end - sourceWindow.start;
    if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
      return { ...sceneInstance };
    }

    return {
      ...sceneInstance,
      temporal: composeSceneTemporalState(sceneInstance.temporal, {
        remapToInput: {
          alpha: sourceSpan / (end - start),
          beta: sourceWindow.start - (sourceSpan * start) / (end - start),
        },
        visibilityWindow: {
          start,
          end,
        },
        marksAuthoredTimeline: true,
      }),
    };
  });
};

export const trimSceneInstancesTemporally = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  start: number,
  end: number,
  sourceTemporalWindowByOriginId?: ReadonlyMap<string, TemporalVisibilityWindow>,
): SceneInstance[] => {
  if (!isNonWrapping01TemporalWindow(start, end)) {
    return [];
  }

  if (isIdentity01TemporalWindow(start, end)) {
    return sceneInstances.map((sceneInstance) => ({ ...sceneInstance }));
  }

  return sceneInstances.map((sceneInstance) => {
    const sourceWindow = resolveSceneInstanceTemporalSourceWindow(
      sceneInstance,
      sourceTemporalWindowByOriginId,
    );
    const sourceSpan = sourceWindow.end - sourceWindow.start;
    if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
      return { ...sceneInstance };
    }

    return {
      ...sceneInstance,
      temporal: composeSceneTemporalState(sceneInstance.temporal, {
        remapToInput: {
          alpha: sourceSpan * (end - start),
          beta: sourceWindow.start + sourceSpan * start,
        },
        visibilityWindow: NORMALIZED_TIMELINE_WINDOW,
        marksAuthoredTimeline: true,
      }),
    };
  });
};

export const reverseSceneInstancesTemporally = (
  sceneInstances: ReadonlyArray<SceneInstance>,
): SceneInstance[] => transformSceneInstancesTemporally(sceneInstances, {
  remapToInput: {
    alpha: -1,
    beta: 1,
  },
  visibilityWindow: NORMALIZED_TIMELINE_WINDOW,
});
