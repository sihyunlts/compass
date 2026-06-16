import type {
  SceneTemporalState,
  TemporalAffineRemap,
  TemporalRemap,
  TemporalVisibilityWindow,
} from '../core-types';

export interface TemporalTransform {
  remapToInput: TemporalRemap;
  visibilityWindow: TemporalVisibilityWindow;
  inputVisibilityWindow?: TemporalVisibilityWindow;
  marksAuthoredTimeline?: boolean;
}

export interface SceneTemporalCompositionOptions {
  inputWindow?: TemporalVisibilityWindow;
}

const DEFAULT_TEMPORAL_SAMPLE_COUNT = 129;

const NORMALIZED_TIMELINE_WINDOW: TemporalVisibilityWindow = {
  start: 0,
  end: 1,
};

const EMPTY_VISIBILITY_WINDOW: TemporalVisibilityWindow = {
  start: 1,
  end: 0,
};

const createAffineTemporalRemap = (
  alpha: number,
  beta: number,
): TemporalAffineRemap => ({
  kind: 'affine',
  alpha,
  beta,
});

const cloneTemporalRemap = (
  remap: TemporalRemap,
): TemporalRemap => remap.kind === 'affine'
  ? {
      kind: 'affine',
      alpha: remap.alpha,
      beta: remap.beta,
    }
  : {
      kind: 'sampled',
      domainStart: remap.domainStart,
      domainEnd: remap.domainEnd,
      samples: [...remap.samples],
    };

export const createIdentitySceneTemporalState = (): SceneTemporalState => ({
  remap: createAffineTemporalRemap(1, 0),
  visibilityWindow: {
    start: NORMALIZED_TIMELINE_WINDOW.start,
    end: NORMALIZED_TIMELINE_WINDOW.end,
  },
  hasAuthoredTimeline: false,
});

export const cloneSceneTemporalState = (
  sceneTemporal: SceneTemporalState,
): SceneTemporalState => ({
  remap: cloneTemporalRemap(sceneTemporal.remap),
  visibilityWindow: {
    start: sceneTemporal.visibilityWindow.start,
    end: sceneTemporal.visibilityWindow.end,
  },
  hasAuthoredTimeline: sceneTemporal.hasAuthoredTimeline,
});

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

const isAffineTemporalRemap = (
  remap: TemporalRemap,
): remap is TemporalAffineRemap => remap.kind === 'affine';

const resolveTemporalSampleCount = (
  ...remaps: readonly TemporalRemap[]
): number => Math.max(
  DEFAULT_TEMPORAL_SAMPLE_COUNT,
  ...remaps.map((remap) => remap.kind === 'sampled' ? remap.samples.length : 0),
);

const interpolateNullableSample = (
  left: number | null,
  right: number | null,
  ratio: number,
): number | null => {
  if (left === null) {
    return ratio <= 0 ? left : null;
  }
  if (right === null) {
    return ratio >= 1 ? right : null;
  }

  return left + (right - left) * ratio;
};

export const evaluateTemporalRemap = (
  remap: TemporalRemap,
  t01: number,
): number | null => {
  if (!Number.isFinite(t01)) {
    return null;
  }

  if (remap.kind === 'affine') {
    return remap.alpha * t01 + remap.beta;
  }

  const sampleCount = remap.samples.length;
  if (sampleCount === 0) {
    return null;
  }
  if (sampleCount === 1) {
    return remap.samples[0];
  }

  const domainStart = remap.domainStart;
  const domainEnd = remap.domainEnd;
  const domainSpan = domainEnd - domainStart;
  if (!Number.isFinite(domainSpan) || domainSpan <= 0) {
    return null;
  }

  const clampedT = Math.min(Math.max(t01, domainStart), domainEnd);
  const normalizedT = (clampedT - domainStart) / domainSpan;
  const scaledIndex = normalizedT * (sampleCount - 1);
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.min(sampleCount - 1, Math.ceil(scaledIndex));
  const ratio = scaledIndex - lowerIndex;
  const lowerSample = remap.samples[lowerIndex] ?? null;
  const upperSample = remap.samples[upperIndex] ?? null;

  return interpolateNullableSample(lowerSample, upperSample, ratio);
};

const resolveSceneTemporalInputTime = (
  sceneTemporal: SceneTemporalState,
  t01: number,
  inputWindow: TemporalVisibilityWindow,
  inputVisibilityWindow: TemporalVisibilityWindow,
): number | null => {
  if (!Number.isFinite(t01) || !isTimeVisibleInWindow(inputVisibilityWindow, t01)) {
    return null;
  }

  const localT = evaluateTemporalRemap(sceneTemporal.remap, t01);
  if (
    localT === null
    || !Number.isFinite(localT)
    || !isTimeVisibleInWindow(inputWindow, localT)
  ) {
    return null;
  }

  return localT;
};

const resolveSampledVisibilityWindow = (
  samples: readonly (number | null)[],
  domainStart: number,
  domainEnd: number,
): TemporalVisibilityWindow => {
  const firstVisibleIndex = samples.findIndex((sample) => sample !== null);
  if (firstVisibleIndex === -1) {
    return EMPTY_VISIBILITY_WINDOW;
  }

  const lastVisibleIndex = samples.findLastIndex((sample) => sample !== null);
  const sampleSpan = Math.max(samples.length - 1, 1);
  const domainSpan = domainEnd - domainStart;
  return {
    start: domainStart + domainSpan * (firstVisibleIndex / sampleSpan),
    end: domainStart + domainSpan * (lastVisibleIndex / sampleSpan),
  };
};

const composeAffineTemporalRemaps = (
  sceneRemap: TemporalAffineRemap,
  transformRemap: TemporalAffineRemap,
): TemporalAffineRemap => createAffineTemporalRemap(
  sceneRemap.alpha * transformRemap.alpha,
  sceneRemap.alpha * transformRemap.beta + sceneRemap.beta,
);

const resolveComposedVisibilityWindow = (
  sceneTemporal: SceneTemporalState,
  transform: TemporalTransform,
): TemporalVisibilityWindow => {
  if (!isAffineTemporalRemap(transform.remapToInput) || !isAffineTemporalRemap(sceneTemporal.remap)) {
    return EMPTY_VISIBILITY_WINDOW;
  }

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

const composeSceneTemporalStateBySampling = (
  sceneTemporal: SceneTemporalState,
  transform: TemporalTransform,
  options: SceneTemporalCompositionOptions,
): SceneTemporalState => {
  const sampleCount = resolveTemporalSampleCount(
    sceneTemporal.remap,
    transform.remapToInput,
  );
  const sampleDomainStart = transform.visibilityWindow.start;
  const sampleDomainEnd = transform.visibilityWindow.end;
  const sampleDomainSpan = sampleDomainEnd - sampleDomainStart;
  if (!Number.isFinite(sampleDomainSpan) || sampleDomainSpan <= 0) {
    return {
      remap: {
        kind: 'sampled',
        domainStart: sampleDomainStart,
        domainEnd: sampleDomainEnd,
        samples: [],
      },
      visibilityWindow: EMPTY_VISIBILITY_WINDOW,
      hasAuthoredTimeline: sceneTemporal.hasAuthoredTimeline || transform.marksAuthoredTimeline === true,
    };
  }

  const samples = Array.from({ length: sampleCount }, (_, index) => {
    const ratio = sampleCount <= 1 ? 0 : index / (sampleCount - 1);
    const t = sampleDomainStart + sampleDomainSpan * ratio;

    const transformedT = evaluateTemporalRemap(transform.remapToInput, t);
    if (transformedT === null) {
      return null;
    }

    return resolveSceneTemporalInputTime(
      sceneTemporal,
      transformedT,
      options.inputWindow ?? NORMALIZED_TIMELINE_WINDOW,
      transform.inputVisibilityWindow ?? sceneTemporal.visibilityWindow,
    );
  });

  return {
    remap: {
      kind: 'sampled',
      domainStart: sampleDomainStart,
      domainEnd: sampleDomainEnd,
      samples,
    },
    visibilityWindow: resolveSampledVisibilityWindow(
      samples,
      sampleDomainStart,
      sampleDomainEnd,
    ),
    hasAuthoredTimeline: sceneTemporal.hasAuthoredTimeline || transform.marksAuthoredTimeline === true,
  };
};

export const composeSceneTemporalState = (
  sceneTemporal: SceneTemporalState,
  transform: TemporalTransform,
  options: SceneTemporalCompositionOptions = {},
): SceneTemporalState => {
  if (isAffineTemporalRemap(sceneTemporal.remap) && isAffineTemporalRemap(transform.remapToInput)) {
    return {
      remap: composeAffineTemporalRemaps(sceneTemporal.remap, transform.remapToInput),
      visibilityWindow: resolveComposedVisibilityWindow(sceneTemporal, transform),
      hasAuthoredTimeline: sceneTemporal.hasAuthoredTimeline || transform.marksAuthoredTimeline === true,
    };
  }

  return composeSceneTemporalStateBySampling(sceneTemporal, transform, options);
};

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
