import {
  addExistingStrokeToFrameRange,
  beginTimelineStage,
  groupPlacementsByOrigin,
  removeOriginStrokes,
  type FrameWindow,
} from '../../timeline';
import type { GeometryStroke, GeometryTimeline } from '../../types';
import { transformStroke } from './timeline-strokes';
import type { OriginFrameRemap } from './types';

interface MonotoneFrameRun extends FrameWindow {
  ascending: boolean;
}

// A time map can reverse or contain gaps. Within each monotone run an input
// interval maps to one output interval, found without expanding its strokes.
const splitMonotoneFrameRuns = (
  indices: ReadonlyArray<number | null>,
  frameCount: number,
): MonotoneFrameRun[] => {
  const runs: MonotoneFrameRun[] = [];
  let startFrame = 0;
  let direction = 0;
  const endFrame = Math.min(indices.length, frameCount);
  for (let frame = 0; frame <= endFrame; frame += 1) {
    const current = frame < endFrame ? indices[frame] : null;
    if (current === null) {
      if (frame > startFrame) {
        runs.push({ startFrame, endFrameExclusive: frame, ascending: direction >= 0 });
      }
      startFrame = frame + 1;
      direction = 0;
    } else if (frame > startFrame) {
      const step = Math.sign(current - indices[frame - 1]!);
      if (step !== 0 && direction !== 0 && step !== direction) {
        runs.push({ startFrame, endFrameExclusive: frame, ascending: direction > 0 });
        startFrame = frame;
        direction = 0;
      } else if (step !== 0) {
        direction = step;
      }
    }
  }
  return runs;
};

const lowerBoundFrame = (
  run: MonotoneFrameRun,
  indices: ReadonlyArray<number | null>,
  boundary: number,
): number => {
  let low = run.startFrame;
  let high = run.endFrameExclusive;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const beforeBoundary = run.ascending
      ? indices[middle]! < boundary
      : indices[middle]! >= boundary;
    if (beforeBoundary) low = middle + 1;
    else high = middle;
  }
  return low;
};

export const createFrameIndexWindowMapper = (
  indices: ReadonlyArray<number | null>,
): OriginFrameRemap['mapSourceWindow'] => {
  const runs = splitMonotoneFrameRuns(indices, indices.length);
  return (window) => runs.map((run) => ({
    startFrame: lowerBoundFrame(run, indices, run.ascending ? window.startFrame : window.endFrameExclusive),
    endFrameExclusive: lowerBoundFrame(run, indices, run.ascending ? window.endFrameExclusive : window.startFrame),
  }));
};

export const remapTimeline = (
  timeline: GeometryTimeline,
  remaps: ReadonlyMap<string, OriginFrameRemap>,
  outputEndBeat: number,
  preserveWriteMetadata: boolean,
): GeometryTimeline => {
  const targetOriginIds = new Set(remaps.keys());
  const nextTimeline = beginTimelineStage(timeline, outputEndBeat);
  removeOriginStrokes(
    nextTimeline,
    targetOriginIds,
    Math.min(timeline.frameCount, nextTimeline.frameCount),
  );
  const placementsByOrigin = groupPlacementsByOrigin(timeline, targetOriginIds);
  let nextWriteId = nextTimeline.nextWriteId;

  for (const [originId, remap] of remaps) {
    const placements = placementsByOrigin.get(originId);
    if (!placements) continue;
    const remappedStrokes = new Map<GeometryStroke, GeometryStroke>();
    if (!preserveWriteMetadata) {
      const sourceStrokes = Array.from(new Set(placements.map(({ stroke }) => stroke)))
        .sort((left, right) => left.writeId - right.writeId);
      for (const stroke of sourceStrokes) {
        remappedStrokes.set(stroke, {
          ...transformStroke(stroke, null, remap.writeOrder),
          writeId: nextWriteId++,
        });
      }
    }
    for (const placement of placements) {
      const stroke = preserveWriteMetadata ? placement.stroke : remappedStrokes.get(placement.stroke)!;
      for (const window of remap.mapSourceWindow(placement)) {
        addExistingStrokeToFrameRange(nextTimeline, window.startFrame, window.endFrameExclusive, stroke);
      }
    }
  }
  return nextTimeline;
};
