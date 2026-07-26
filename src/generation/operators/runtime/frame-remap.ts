import type { BeatRange } from '../../analysis/types';
import {
  addExistingStrokeToFrame,
  beginTimelineStage,
  completeTimelineStage,
} from '../../timeline';
import type { GeometryStroke, GeometryTimeline } from '../../types';
import { isFrameWithinWindow, resolveFrameWindow } from './frame-window';
import {
  buildSourceStrokesByOriginAndFrame,
  stripOriginFrames,
  transformStroke,
} from './timeline-strokes';
import type { OriginFrameRemap } from './types';

const buildRemappedStrokeBySource = (
  sourceStrokesByOriginAndFrame: ReadonlyMap<string, ReadonlyMap<number, GeometryStroke[]>>,
  remaps: ReadonlyMap<string, OriginFrameRemap>,
  firstWriteId: number,
): WeakMap<GeometryStroke, GeometryStroke> => {
  const remappedStrokeBySource = new WeakMap<GeometryStroke, GeometryStroke>();
  let nextWriteId = firstWriteId;

  for (const [originId, remap] of remaps.entries()) {
    const sourceStrokesByFrame = sourceStrokesByOriginAndFrame.get(originId);
    if (!sourceStrokesByFrame) {
      continue;
    }

    const uniqueSourceStrokes = new Set<GeometryStroke>();
    for (const frameStrokes of sourceStrokesByFrame.values()) {
      for (const stroke of frameStrokes) {
        uniqueSourceStrokes.add(stroke);
      }
    }
    const sourceStrokes = Array.from(uniqueSourceStrokes)
      .sort((left, right) => left.writeId - right.writeId);

    for (const sourceStroke of sourceStrokes) {
      remappedStrokeBySource.set(sourceStroke, {
        ...transformStroke(sourceStroke, null, remap.writeOrder),
        writeId: nextWriteId,
      });
      nextWriteId += 1;
    }
  }

  return remappedStrokeBySource;
};

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
  const remappedStrokeBySource = preserveWriteMetadata
    ? null
    : buildRemappedStrokeBySource(
        sourceStrokesByOriginAndFrame,
        remaps,
        nextTimeline.nextWriteId,
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

        // Source write ids define stable order within each origin. Assigning one
        // remap-stage id per immutable source stroke preserves that order while
        // sharing the temporal placement across output frames.
        const remappedStroke = remappedStrokeBySource?.get(stroke);
        if (!remappedStroke) {
          throw new Error('Temporal remap stroke cache is incomplete.');
        }
        addExistingStrokeToFrame(nextTimeline, frameIndex, remappedStroke);
      }
    }
  }

  return completeTimelineStage(nextTimeline);
};
