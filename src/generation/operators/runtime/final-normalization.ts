import type { GenerationState, OriginTimelineState } from '../../timeline/state';
import { FIXED_TIMELINE_END_BEAT, type TimelineWindow } from '../../timeline/temporal-window';
import type { GeometryTimeline } from '../../types';
import { remapTimeline } from './frame-remap';
import { buildSourceWindowOriginFrameRemap } from './origin-frame-remap';
import type { OriginFrameRemap } from './types';

const resolveFinalSourceWindow = (
  timelineState: OriginTimelineState,
): TimelineWindow => timelineState.timelineDomain === 'fixed'
  ? {
      start: Math.min(timelineState.playbackExtent.start, timelineState.observedWindow.start),
      end: Math.max(timelineState.playbackExtent.end, timelineState.observedWindow.end),
    }
  : timelineState.observedWindow;

const buildFinalOriginRemaps = (
  state: GenerationState,
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
  state: GenerationState,
): GeometryTimeline => remapTimeline(
  state.timeline,
  buildFinalOriginRemaps(state),
  FIXED_TIMELINE_END_BEAT,
  true,
);
