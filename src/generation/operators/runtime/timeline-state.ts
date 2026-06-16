import type { SceneTemporalState } from '../../../core/core-types';
import {
  cloneSceneTemporalState,
  createIdentitySceneTemporalState,
} from '../../../core/scene-operators/temporal';
import {
  cloneTimelineWindow,
  createMaterializedTemporalState,
  EMPTY_TIMELINE_WINDOW,
  mergeTimelineWindows,
  TIMELINE_WINDOW_EPSILON,
  type TimelineWindow,
} from '../../timeline/temporal-window';
import type { OriginTimelineState } from '../../timeline/state';
import type { CanonicalOutputAdapter, GeometryTimeline } from '../../types';

const buildTimelineStateMap = (
  originIds: Iterable<string>,
  observedWindowByOriginId: ReadonlyMap<string, TimelineWindow>,
  resolveTemporalState: (originId: string, observedWindow: TimelineWindow) => SceneTemporalState,
  resolvePlaybackWindow: (originId: string, observedWindow: TimelineWindow) => TimelineWindow = (
    _originId,
    observedWindow,
  ) => observedWindow,
): Map<string, OriginTimelineState> => {
  const timelineStateByOriginId = new Map<string, OriginTimelineState>();

  for (const originId of originIds) {
    const observedWindow = cloneTimelineWindow(
      observedWindowByOriginId.get(originId) ?? EMPTY_TIMELINE_WINDOW,
    );
    const playbackWindow = cloneTimelineWindow(resolvePlaybackWindow(originId, observedWindow));
    timelineStateByOriginId.set(originId, {
      observedWindow,
      playbackWindow,
      temporal: resolveTemporalState(originId, observedWindow),
    });
  }

  return timelineStateByOriginId;
};

const isSameTimelineWindow = (
  left: TimelineWindow,
  right: TimelineWindow,
): boolean => Math.abs(left.start - right.start) <= TIMELINE_WINDOW_EPSILON
  && Math.abs(left.end - right.end) <= TIMELINE_WINDOW_EPSILON;

export const buildTimelineStateByOriginId = (
  timeline: GeometryTimeline,
  previousTimelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
  temporalOverrides: ReadonlyMap<string, SceneTemporalState> = new Map(),
  playbackWindowOverrides: ReadonlyMap<string, TimelineWindow> = new Map(),
): Map<string, OriginTimelineState> => {
  const observedWindowByOriginId = outputAdapter.buildVisibleWindowByOriginId(
    timeline,
    mutedGroupIds,
    mutedGeneratorIds,
  );
  const originIds = new Set<string>([
    ...previousTimelineStateByOriginId.keys(),
    ...observedWindowByOriginId.keys(),
    ...temporalOverrides.keys(),
    ...playbackWindowOverrides.keys(),
  ]);

  return buildTimelineStateMap(
    originIds,
    observedWindowByOriginId,
    (originId) => {
      const previous = previousTimelineStateByOriginId.get(originId);
      return temporalOverrides.has(originId)
        ? cloneSceneTemporalState(temporalOverrides.get(originId) ?? createIdentitySceneTemporalState())
        : cloneSceneTemporalState(previous?.temporal ?? createIdentitySceneTemporalState());
    },
    (originId, observedWindow) => {
      const override = playbackWindowOverrides.get(originId);
      if (override) {
        return mergeTimelineWindows(observedWindow, override);
      }

      const previous = previousTimelineStateByOriginId.get(originId);
      if (previous && isSameTimelineWindow(previous.observedWindow, observedWindow)) {
        return cloneTimelineWindow(previous.playbackWindow);
      }

      return observedWindow;
    },
  );
};

export const buildTimelineStateAfterTemporalMaterialization = (
  timeline: GeometryTimeline,
  previousTimelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
  pendingOriginIds: ReadonlySet<string>,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
  materializedTemporalByOriginId: ReadonlyMap<string, SceneTemporalState> = new Map(),
): Map<string, OriginTimelineState> => {
  const observedWindowByOriginId = outputAdapter.buildVisibleWindowByOriginId(
    timeline,
    mutedGroupIds,
    mutedGeneratorIds,
  );
  const originIds = new Set<string>([
    ...previousTimelineStateByOriginId.keys(),
    ...observedWindowByOriginId.keys(),
  ]);

  return buildTimelineStateMap(
    originIds,
    observedWindowByOriginId,
    (originId, observedWindow) => {
      const previous = previousTimelineStateByOriginId.get(originId);
      if (!previous || !pendingOriginIds.has(originId)) {
        return cloneSceneTemporalState(previous?.temporal ?? createIdentitySceneTemporalState());
      }

      return cloneSceneTemporalState(
        materializedTemporalByOriginId.get(originId) ?? createMaterializedTemporalState(observedWindow),
      );
    },
    (_originId, observedWindow) => observedWindow,
  );
};
