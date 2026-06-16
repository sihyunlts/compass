import type {
  SceneTemporalState,
  TemporalAffineRemap,
  TemporalRemap,
} from '../../core/core-types';
import {
  cloneSceneTemporalState,
  composeSceneTemporalState,
  type TemporalTransform,
} from '../../core/scene-operators/temporal';
import type { GenerationTimelineWindow } from '../types';
import type { OriginTimelineState } from './state';

export type TimelineWindow = GenerationTimelineWindow;

export const DEFAULT_TIMELINE_WINDOW: TimelineWindow = Object.freeze({
  start: 0,
  end: 1,
});

export const EMPTY_TIMELINE_WINDOW: TimelineWindow = Object.freeze({
  start: 0,
  end: 0,
});

export const FIXED_TIMELINE_END_BEAT = DEFAULT_TIMELINE_WINDOW.end;
export const TIMELINE_WINDOW_EPSILON = 1e-9;

export const cloneTimelineWindow = (
  window: TimelineWindow,
): TimelineWindow => ({
  start: window.start,
  end: window.end,
});

export const isWindowEmpty = (
  window: TimelineWindow | null,
): boolean => !window || window.end <= window.start + TIMELINE_WINDOW_EPSILON;

export const mergeTimelineWindows = (
  left: TimelineWindow | null | undefined,
  right: TimelineWindow | null | undefined,
): TimelineWindow => {
  if (isWindowEmpty(left)) {
    return cloneTimelineWindow(right ?? EMPTY_TIMELINE_WINDOW);
  }
  if (isWindowEmpty(right)) {
    return cloneTimelineWindow(left);
  }

  return {
    start: Math.min(left.start, right.start),
    end: Math.max(left.end, right.end),
  };
};

const isIdentityTemporalRemap = (
  remap: TemporalRemap,
): boolean => remap.kind === 'affine'
  && Math.abs(remap.alpha - 1) <= TIMELINE_WINDOW_EPSILON
  && Math.abs(remap.beta) <= TIMELINE_WINDOW_EPSILON;

export const hasPendingTemporalState = (
  timelineState: OriginTimelineState,
): boolean => timelineState.temporal.hasAuthoredTimeline || !isIdentityTemporalRemap(timelineState.temporal.remap);

const clampTimelineWindowToFixedLoop = (
  window: TimelineWindow,
): TimelineWindow => ({
  start: Math.max(window.start, DEFAULT_TIMELINE_WINDOW.start),
  end: Math.min(window.end, FIXED_TIMELINE_END_BEAT),
});

export const isFixedTimelineWindow = (
  window: TimelineWindow,
): boolean => Math.abs(window.start - DEFAULT_TIMELINE_WINDOW.start) <= TIMELINE_WINDOW_EPSILON
  && Math.abs(window.end - FIXED_TIMELINE_END_BEAT) <= TIMELINE_WINDOW_EPSILON;

const createAffineTemporalRemap = (
  alpha: number,
  beta: number,
): TemporalAffineRemap => ({
  kind: 'affine',
  alpha,
  beta,
});

const createSampledPlacementRemap = (
  placementWindow: TimelineWindow,
  remap: TemporalRemap,
): TemporalRemap => {
  if (remap.kind === 'affine') {
    const placementSpan = placementWindow.end - placementWindow.start;
    return createAffineTemporalRemap(
      remap.alpha,
      placementWindow.start + placementSpan * remap.beta - placementWindow.start * remap.alpha,
    );
  }

  const placementSpan = placementWindow.end - placementWindow.start;
  return {
    kind: 'sampled',
    domainStart: placementWindow.start,
    domainEnd: placementWindow.end,
    samples: remap.samples.map((sample) => (
      sample === null ? null : placementWindow.start + placementSpan * sample
    )),
  };
};

export const resolveTemporalPlacementWindow = (
  timelineState: OriginTimelineState | undefined,
): TimelineWindow => cloneTimelineWindow(timelineState?.temporal.visibilityWindow ?? DEFAULT_TIMELINE_WINDOW);

export const resolveTemporalSourceWindow = (
  timelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
  originId: string,
): TimelineWindow | null => {
  const timelineState = timelineStateByOriginId.get(originId);
  if (!timelineState) {
    return null;
  }

  if (timelineState.temporal.hasAuthoredTimeline) {
    return cloneTimelineWindow(DEFAULT_TIMELINE_WINDOW);
  }

  return timelineState.playbackWindow.end > timelineState.playbackWindow.start
    ? cloneTimelineWindow(timelineState.playbackWindow)
    : cloneTimelineWindow(timelineState.temporal.visibilityWindow);
};

export const buildStretchTransform = (
  sourceWindow: TimelineWindow,
  start: number,
  end: number,
): TemporalTransform => {
  const sourceSpan = sourceWindow.end - sourceWindow.start;

  return {
    remapToInput: createAffineTemporalRemap(
      sourceSpan / (end - start),
      sourceWindow.start - (sourceSpan * start) / (end - start),
    ),
    visibilityWindow: { start, end },
    marksAuthoredTimeline: true,
  };
};

export const buildTrimTransform = (
  sourceWindow: TimelineWindow,
  start: number,
  end: number,
): TemporalTransform => {
  const sourceSpan = sourceWindow.end - sourceWindow.start;

  return {
    remapToInput: createAffineTemporalRemap(
      sourceSpan * (end - start),
      sourceWindow.start + sourceSpan * start,
    ),
    visibilityWindow: cloneTimelineWindow(DEFAULT_TIMELINE_WINDOW),
    marksAuthoredTimeline: true,
  };
};

export const buildReverseTransform = (
  sourceWindow: TimelineWindow,
  placementWindow: TimelineWindow,
  sampleStepBeats: number,
): TemporalTransform => {
  const sourceSpan = sourceWindow.end - sourceWindow.start;
  const placementSpan = placementWindow.end - placementWindow.start;
  const sourceFrameSpan = sourceSpan - sampleStepBeats;
  const placementFrameSpan = placementSpan - sampleStepBeats;
  const sourceEndBeat = sourceWindow.end - sampleStepBeats;
  const alpha = sourceFrameSpan > 0 && placementFrameSpan > 0
    ? -sourceFrameSpan / placementFrameSpan
    : -sourceSpan / placementSpan;

  return {
    remapToInput: createAffineTemporalRemap(
      alpha,
      (sourceFrameSpan > 0 && placementFrameSpan > 0 ? sourceEndBeat : sourceWindow.end)
        - alpha * placementWindow.start,
    ),
    visibilityWindow: cloneTimelineWindow(placementWindow),
    inputVisibilityWindow: {
      start: sourceFrameSpan > 0 ? sourceWindow.start - sampleStepBeats : sourceWindow.start,
      end: sourceWindow.end,
    },
  };
};

export const buildPlacementPreservingTimeWarpTransform = (
  placementWindow: TimelineWindow,
  remap: TemporalRemap,
): TemporalTransform => ({
  remapToInput: createSampledPlacementRemap(placementWindow, remap),
  visibilityWindow: cloneTimelineWindow(placementWindow),
});

export const buildSourceWindowTimeWarpTransform = (
  sourceWindow: TimelineWindow,
  placementWindow: TimelineWindow,
  remap: TemporalRemap,
): TemporalTransform => {
  const sourceSpan = sourceWindow.end - sourceWindow.start;
  if (remap.kind === 'affine') {
    const placementSpan = placementWindow.end - placementWindow.start;
    return {
      remapToInput: createAffineTemporalRemap(
        (sourceSpan * remap.alpha) / placementSpan,
        sourceWindow.start + sourceSpan * remap.beta
          - ((sourceSpan * remap.alpha * placementWindow.start) / placementSpan),
      ),
      visibilityWindow: cloneTimelineWindow(placementWindow),
    };
  }

  return {
    remapToInput: {
      kind: 'sampled',
      domainStart: placementWindow.start,
      domainEnd: placementWindow.end,
      samples: remap.samples.map((sample) => (
        sample === null ? null : sourceWindow.start + sourceSpan * sample
      )),
    },
    visibilityWindow: cloneTimelineWindow(placementWindow),
  };
};

export const buildTimeWarpTransform = (
  sourceWindow: TimelineWindow,
  placementWindow: TimelineWindow,
  remap: TemporalRemap,
): TemporalTransform => (
  isFixedTimelineWindow(sourceWindow)
    ? buildPlacementPreservingTimeWarpTransform(placementWindow, remap)
    : buildSourceWindowTimeWarpTransform(sourceWindow, placementWindow, remap)
);

export const composeTimelineWindowTemporalState = (
  timelineState: OriginTimelineState,
  currentTemporal: SceneTemporalState,
  transform: TemporalTransform,
): SceneTemporalState => composeSceneTemporalState(
  currentTemporal,
  transform,
  {
    inputWindow: timelineState.temporal.hasAuthoredTimeline
      ? DEFAULT_TIMELINE_WINDOW
      : timelineState.playbackWindow,
  },
);

export const clampSceneTemporalStateToFixedLoop = (
  sceneTemporal: SceneTemporalState,
): SceneTemporalState => ({
  ...cloneSceneTemporalState(sceneTemporal),
  visibilityWindow: clampTimelineWindowToFixedLoop(sceneTemporal.visibilityWindow),
});

export const createMaterializedTemporalState = (
  visibilityWindow: TimelineWindow,
): SceneTemporalState => ({
  remap: createAffineTemporalRemap(1, 0),
  visibilityWindow: cloneTimelineWindow(visibilityWindow),
  hasAuthoredTimeline: false,
});
