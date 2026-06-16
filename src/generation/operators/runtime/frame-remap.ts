import type { BeatRange } from '../../analysis/types';
import {
  addExistingStrokeToFrame,
  beginTimelineStage,
  completeTimelineStage,
} from '../../timeline';
import type {
  GeometryTimeline,
} from '../../types';
import { isFrameWithinWindow, resolveFrameWindow } from './frame-window';
import {
  addRemappedStrokeToFrame,
  buildSourceStrokesByOriginAndFrame,
  stripOriginFrames,
} from './timeline-strokes';
import type { OriginFrameRemap } from './types';

export const remapTimeline = (
  timeline: GeometryTimeline,
  remaps: ReadonlyMap<string, OriginFrameRemap>,
  requiredFrameWindow: BeatRange | 'all',
  outputEndBeat: number,
  preserveWriteMetadata: boolean,
): GeometryTimeline => {
  const targetOriginIds = new Set(remaps.keys());
  const nextTimeline = beginTimelineStage(timeline, outputEndBeat);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    timeline.sampleStepBeats,
    nextTimeline.frames.length,
  );

  stripOriginFrames(
    nextTimeline,
    Math.min(timeline.frames.length, nextTimeline.frames.length),
    targetOriginIds,
  );

  const sourceStrokesByOriginAndFrame = buildSourceStrokesByOriginAndFrame(
    timeline,
    targetOriginIds,
  );
  for (const [originId, remap] of remaps.entries()) {
    const sourceStrokesByFrame = sourceStrokesByOriginAndFrame.get(originId);
    if (!sourceStrokesByFrame) {
      continue;
    }

    for (
      let frameIndex = 0;
      frameIndex < Math.min(remap.sourceFrameIndexByOutputFrame.length, nextTimeline.frames.length);
      frameIndex += 1
    ) {
      if (!isFrameWithinWindow(frameIndex, frameWindow)) {
        continue;
      }

      const sourceFrameIndex = remap.sourceFrameIndexByOutputFrame[frameIndex];
      if (sourceFrameIndex === null || sourceFrameIndex === undefined) {
        continue;
      }

      const sourceStrokes = sourceStrokesByFrame.get(sourceFrameIndex);
      if (!sourceStrokes || sourceStrokes.length === 0) {
        continue;
      }

      for (const stroke of sourceStrokes) {
        if (preserveWriteMetadata) {
          addExistingStrokeToFrame(nextTimeline, frameIndex, stroke);
          continue;
        }

        addRemappedStrokeToFrame(nextTimeline, frameIndex, stroke, remap.writeOrder);
      }
    }
  }

  return completeTimelineStage(nextTimeline);
};
