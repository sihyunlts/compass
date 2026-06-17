import type { FrameWindow } from '../../timeline';
import { toFrameWindow } from '../../timeline';
import type { GeometryTimeline } from '../../types';
import type { TimelineWindow } from '../../timeline/temporal-window';

export const resolveFrameSampleRatio = (
  frameIndex: number,
  frameWindow: FrameWindow,
): number => {
  const frameSpan = frameWindow.endFrameExclusive - frameWindow.startFrame;
  if (frameSpan <= 1) {
    return 0;
  }

  return (frameIndex - frameWindow.startFrame) / (frameSpan - 1);
};

export const resolveWindowSampleBeatForFrame = (
  frameIndex: number,
  frameWindow: FrameWindow,
  window: TimelineWindow,
): number => window.start
  + (window.end - window.start) * resolveFrameSampleRatio(frameIndex, frameWindow);

export const resolveTimelineWindowFrameWindow = (
  timeline: GeometryTimeline,
  outputFrameCount: number,
  window: TimelineWindow,
): FrameWindow => toFrameWindow(
  window,
  timeline.sampleStepBeats,
  outputFrameCount,
);
