import type { SceneTemporalState } from '../../../core/core-types';
import {
  cloneSceneTemporalState,
  createIdentitySceneTemporalState,
} from '../../../core/scene-operators/temporal';
import {
  cloneTimelineWindow,
  createMaterializedTemporalState,
  EMPTY_TIMELINE_WINDOW,
  type TimelineWindow,
} from '../../timeline/temporal-window';
import type { OriginTimelineState } from '../../timeline/state';
import type { CanonicalOutputAdapter, GeometryTimeline } from '../../types';

const buildTimelineStateMap = (
  originIds: Iterable<string>,
  observedWindowByOriginId: ReadonlyMap<string, TimelineWindow>,
  resolveTemporalState: (originId: string, observedWindow: TimelineWindow) => SceneTemporalState,
): Map<string, OriginTimelineState> => {
  const timelineStateByOriginId = new Map<string, OriginTimelineState>();

  for (const originId of originIds) {
    const observedWindow = cloneTimelineWindow(
      observedWindowByOriginId.get(originId) ?? EMPTY_TIMELINE_WINDOW,
    );
    timelineStateByOriginId.set(originId, {
      observedWindow,
      temporal: resolveTemporalState(originId, observedWindow),
    });
  }

  return timelineStateByOriginId;
};

export const buildTimelineStateByOriginId = (
  timeline: GeometryTimeline,
  previousTimelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
  temporalOverrides: ReadonlyMap<string, SceneTemporalState> = new Map(),
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
  );
};

export const buildTimelineStateAfterTemporalMaterialization = (
  timeline: GeometryTimeline,
  previousTimelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
  pendingOriginIds: ReadonlySet<string>,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
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

      return createMaterializedTemporalState(observedWindow);
    },
  );
};
