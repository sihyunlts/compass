import type { GenerationTimelineWindow } from '../types';

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
