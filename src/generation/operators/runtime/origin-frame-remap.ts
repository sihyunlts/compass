import { toFrameCount } from '../../timeline';
import type { TimelineWindow } from '../../timeline/temporal-window';
import type { GeometryTimeline } from '../../types';
import type { OriginFrameRemap } from './types';
import { toSourceFrameIndex } from './timeline-strokes';

export const buildSourceWindowOriginFrameRemap = (
  timeline: GeometryTimeline,
  outputEndBeat: number,
  sourceWindow: TimelineWindow,
  writeOrder: number,
): OriginFrameRemap | null => {
  const sourceSpan = sourceWindow.end - sourceWindow.start;
  if (!Number.isFinite(sourceSpan) || sourceSpan <= 0 || !Number.isFinite(outputEndBeat) || outputEndBeat <= 0) {
    return null;
  }

  const outputFrameCount = toFrameCount(outputEndBeat, timeline.sampleStepBeats);
  return {
    sourceFrameIndexByOutputFrame: Array.from({ length: outputFrameCount }, (_, frameIndex) => {
      const outputBeat = frameIndex * timeline.sampleStepBeats;
      const progress = outputBeat / outputEndBeat;
      const sourceBeat = sourceWindow.start + (sourceSpan * progress);
      return toSourceFrameIndex(sourceBeat, timeline);
    }),
    writeOrder,
  };
};
