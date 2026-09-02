import {
  cloneTimelineStateByOriginId,
  type OriginTimelineState,
} from '../../timeline/state';
import {
  DEFAULT_TIMELINE_WINDOW,
  EMPTY_TIMELINE_WINDOW,
  type TimelineWindow,
} from '../../timeline/temporal-window';
import type {
  CanonicalOutputAdapter,
  GenerationTimelineDomain,
  GeometryTimeline,
} from '../../types';

export interface OriginTimelineStateOverride {
  playbackExtent?: TimelineWindow;
  timelineDomain?: GenerationTimelineDomain;
}

export const applyTimelineStateOverrides = (
  timelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
  overridesByOriginId: ReadonlyMap<string, OriginTimelineStateOverride>,
): Map<string, OriginTimelineState> => {
  const nextTimelineStateByOriginId = cloneTimelineStateByOriginId(timelineStateByOriginId);

  for (const [originId, override] of overridesByOriginId) {
    const current = nextTimelineStateByOriginId.get(originId);
    if (!current) {
      continue;
    }

    nextTimelineStateByOriginId.set(originId, {
      ...current,
      playbackExtent: override.playbackExtent
        ? {
            start: override.playbackExtent.start,
            end: override.playbackExtent.end,
          }
        : current.playbackExtent,
      timelineDomain: override.timelineDomain ?? current.timelineDomain,
    });
  }

  return nextTimelineStateByOriginId;
};

export const hasTimelineSpan = (
  window: TimelineWindow | undefined,
): window is TimelineWindow => Boolean(
  window
  && Number.isFinite(window.start)
  && Number.isFinite(window.end)
  && window.end > window.start,
);

const mergeTimelineSpans = (
  left: TimelineWindow,
  right: TimelineWindow,
): TimelineWindow => ({
  start: Math.min(left.start, right.start),
  end: Math.max(left.end, right.end),
});

const resolvePlaybackExtent = (
  observedWindow: TimelineWindow,
  previousState: OriginTimelineState | undefined,
  override: TimelineWindow | undefined,
): TimelineWindow => {
  if (!override) {
    return previousState?.playbackExtent ?? observedWindow;
  }

  const authoredExtent = mergeTimelineSpans(observedWindow, override);
  return previousState?.timelineDomain === 'fixed'
    && hasTimelineSpan(previousState.playbackExtent)
    ? mergeTimelineSpans(previousState.playbackExtent, authoredExtent)
    : authoredExtent;
};

export const buildTimelineStateByOriginId = (
  timeline: GeometryTimeline,
  previousTimelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
  overridesByOriginId: ReadonlyMap<string, OriginTimelineStateOverride> = new Map(),
): Map<string, OriginTimelineState> => {
  const observedWindowByOriginId = outputAdapter.buildVisibleWindowByOriginId(
    timeline,
    mutedGroupIds,
    mutedGeneratorIds,
  );
  const originIds = new Set<string>([
    ...previousTimelineStateByOriginId.keys(),
    ...observedWindowByOriginId.keys(),
    ...overridesByOriginId.keys(),
  ]);
  const timelineStateByOriginId = new Map<string, OriginTimelineState>();

  for (const originId of originIds) {
    const observedWindow = observedWindowByOriginId.get(originId) ?? EMPTY_TIMELINE_WINDOW;
    const override = overridesByOriginId.get(originId);
    const playbackExtentOverride = override?.playbackExtent;
    const previousState = previousTimelineStateByOriginId.get(originId);
    const playbackExtent = resolvePlaybackExtent(
      observedWindow,
      previousState,
      playbackExtentOverride,
    );
    timelineStateByOriginId.set(originId, {
      observedWindow: {
        start: observedWindow.start,
        end: observedWindow.end,
      },
      playbackExtent: {
        start: playbackExtent.start,
        end: playbackExtent.end,
      },
      timelineDomain: override?.timelineDomain
        ?? previousTimelineStateByOriginId.get(originId)?.timelineDomain
        ?? 'natural',
    });
  }

  return timelineStateByOriginId;
};

export const seedGeneratedOriginTimelineState = (
  timelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
  originId: string,
  timelineDomain: GenerationTimelineDomain = 'natural',
): Map<string, OriginTimelineState> => {
  const nextTimelineStateByOriginId = cloneTimelineStateByOriginId(timelineStateByOriginId);
  nextTimelineStateByOriginId.set(originId, {
    observedWindow: EMPTY_TIMELINE_WINDOW,
    playbackExtent: timelineDomain === 'fixed'
      ? DEFAULT_TIMELINE_WINDOW
      : EMPTY_TIMELINE_WINDOW,
    timelineDomain,
  });

  return nextTimelineStateByOriginId;
};

export const buildFixedTimelineStateOverrides = (
  originIds: Iterable<string>,
): ReadonlyMap<string, OriginTimelineStateOverride> => new Map(
  Array.from(originIds, (originId) => [originId, {
    playbackExtent: DEFAULT_TIMELINE_WINDOW,
    timelineDomain: 'fixed',
  }] as const),
);

export const resolveCanonicalSourceWindow = (
  timelineState: OriginTimelineState,
): TimelineWindow => {
  const sourceWindow = timelineState.timelineDomain === 'fixed'
    && hasTimelineSpan(timelineState.playbackExtent)
    ? timelineState.playbackExtent
    : timelineState.observedWindow;
  return {
    start: sourceWindow.start,
    end: sourceWindow.end,
  };
};
