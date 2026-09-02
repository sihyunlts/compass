import type { MutableGenerationState, OriginTimelineState } from '../../timeline/state';
import {
  DEFAULT_TIMELINE_WINDOW,
  FIXED_TIMELINE_END_BEAT,
  type TimelineWindow,
} from '../../timeline/temporal-window';
import type { GeometryTimeline } from '../../types';
import { remapTimeline } from './frame-remap';
import { buildSourceWindowOriginFrameRemap } from './origin-frame-remap';
import type { OriginFrameRemap } from './types';

const resolveFinalSourceWindow = (
  timelineState: OriginTimelineState,
): TimelineWindow => timelineState.timelineDomain === 'fixed'
  ? {
      start: Math.min(DEFAULT_TIMELINE_WINDOW.start, timelineState.observedWindow.start),
      end: Math.max(DEFAULT_TIMELINE_WINDOW.end, timelineState.observedWindow.end),
    }
  : timelineState.observedWindow;

const buildFinalOriginRemaps = (
  state: MutableGenerationState,
): Map<string, OriginFrameRemap> => {
  const remaps = new Map<string, OriginFrameRemap>();

  for (const [originId, timelineState] of state.timelineStateByOriginId.entries()) {
    const remap = buildSourceWindowOriginFrameRemap(
      state.timeline,
      FIXED_TIMELINE_END_BEAT,
      resolveFinalSourceWindow(timelineState),
      0,
    );
    if (remap) {
      remaps.set(originId, remap);
    }
  }

  return remaps;
};

export const applyFinalTimelineNormalization = (
  state: MutableGenerationState,
): GeometryTimeline => remapTimeline(
  state.timeline,
  buildFinalOriginRemaps(state),
  'all',
  FIXED_TIMELINE_END_BEAT,
  true,
);
