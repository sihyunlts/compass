import type {
  SceneInstance,
  SceneTemporalState,
  TemporalAffineRemap,
  TemporalVisibilityWindow,
} from '../core-types';

export interface TemporalTransform {
  remapToInput: TemporalAffineRemap;
  visibilityWindow: TemporalVisibilityWindow;
}

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

export const stretchSceneInstancesTemporally = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  start: number,
  end: number,
): SceneInstance[] => {
  if (!isNonWrapping01TemporalWindow(start, end)) {
    return [];
  }

  return transformSceneInstancesTemporally(sceneInstances, {
    remapToInput: {
      alpha: end - start,
      beta: start,
    },
    visibilityWindow: {
      start: 0,
      end: 1,
    },
  });
};

export const trimSceneInstancesTemporally = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  start: number,
  end: number,
): SceneInstance[] => {
  if (!isNonWrapping01TemporalWindow(start, end)) {
    return [];
  }

  return transformSceneInstancesTemporally(sceneInstances, {
    remapToInput: {
      alpha: 1,
      beta: 0,
    },
    visibilityWindow: {
      start,
      end,
    },
  });
};

export const reverseSceneInstancesTemporally = (
  sceneInstances: ReadonlyArray<SceneInstance>,
): SceneInstance[] => transformSceneInstancesTemporally(sceneInstances, {
  remapToInput: {
    alpha: -1,
    beta: 1,
  },
  visibilityWindow: {
    start: 0,
    end: 1,
  },
});
