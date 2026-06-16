import type { BeatRange } from '../../analysis/types';
import { FIXED_TIMELINE_END_BEAT } from '../../timeline/temporal-window';
import type { GeometryTimeline } from '../../types';
import { remapTimeline } from './frame-remap';
import type { OriginFrameRemap } from './types';

export interface TimelineRemapPolicy {
  outputEndBeat: number;
  requiredFrameWindow: BeatRange | 'all';
  preserveWriteMetadata: boolean;
  applyWhenEmpty: boolean;
}

export interface TimelineRemapPlan {
  outputEndBeat: number;
  originIds: ReadonlySet<string>;
  originRemaps: ReadonlyMap<string, OriginFrameRemap>;
  timeline: GeometryTimeline;
}

export const createFixedTimelineRemapPolicy = (
  overrides: Partial<TimelineRemapPolicy> = {},
): TimelineRemapPolicy => ({
  outputEndBeat: FIXED_TIMELINE_END_BEAT,
  requiredFrameWindow: 'all',
  preserveWriteMetadata: false,
  applyWhenEmpty: false,
  ...overrides,
});

export const buildTimelineRemapPlan = (
  timeline: GeometryTimeline,
  originRemaps: ReadonlyMap<string, OriginFrameRemap>,
  policy: TimelineRemapPolicy,
): TimelineRemapPlan => {
  const shouldApplyRemap = originRemaps.size > 0 || policy.applyWhenEmpty;

  return {
    outputEndBeat: policy.outputEndBeat,
    originIds: new Set(originRemaps.keys()),
    originRemaps,
    timeline: shouldApplyRemap
      ? remapTimeline(
          timeline,
          originRemaps,
          policy.requiredFrameWindow,
          policy.outputEndBeat,
          policy.preserveWriteMetadata,
        )
      : timeline,
  };
};
