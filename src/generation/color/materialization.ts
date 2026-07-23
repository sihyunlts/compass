import type { GeometryStateEvent } from '../geometry/event-track';
import { extractGeometryEventTracks } from '../geometry/event-track';
import {
  addStrokeToFrameRange,
  beginTimelineStage,
  completeTimelineStage,
  deleteOrigins,
  setFrameStrokes,
  type FrameWindow,
} from '../timeline';
import type {
  GeometryMask,
  GeometryStroke,
  GeometryTimeline,
} from '../types';
import type { CompiledColorAgeKernel } from './types';

export interface ColorTimelineMaterializationInput {
  sourceTimeline: GeometryTimeline;
  targetOriginIds: ReadonlySet<string>;
  sourceFrameWindow: FrameWindow;
  kernel: CompiledColorAgeKernel;
  writeOrder: number;
}

export interface ColorTimelineMaterializationResult {
  timeline: GeometryTimeline;
  playbackWindowByOriginId: ReadonlyMap<string, {
    start: number;
    end: number;
  }>;
}

interface ColorAgeWrite {
  event: GeometryStateEvent;
  startFrame: number;
  endFrameExclusive: number;
  velocity: number;
}

const COLOR_AGE_EPSILON = 1e-9;

const cloneMask = (
  mask: GeometryMask,
): GeometryMask => ({
  contains: mask.contains,
  inverseTransform: { ...mask.inverseTransform },
});

const colorizeEventStroke = (
  stroke: GeometryStroke,
  velocity: number,
  writeOrder: number,
): Omit<GeometryStroke, 'writeId'> => ({
  polyline: {
    ...stroke.polyline,
    velocity,
    points: stroke.polyline.points,
    clipStack: stroke.polyline.clipStack,
  },
  originGroupId: stroke.originGroupId,
  writeOrder,
  masks: stroke.masks.map(cloneMask),
});

const median = (
  values: ReadonlyArray<number>,
): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const resolveReferenceFrameCountByRunIndex = (
  events: ReadonlyArray<GeometryStateEvent>,
  kernel: CompiledColorAgeKernel,
): ReadonlyMap<number, number> => {
  const eventsByRunIndex = new Map<number, GeometryStateEvent[]>();
  for (const event of events) {
    const runEvents = eventsByRunIndex.get(event.runIndex);
    if (runEvents) {
      runEvents.push(event);
    } else {
      eventsByRunIndex.set(event.runIndex, [event]);
    }
  }

  const referenceFrameCountByRunIndex = new Map<number, number>();
  for (const [runIndex, runEvents] of eventsByRunIndex.entries()) {
    const motionCadence = median(
      runEvents
        .map((event) => event.motionUnitFrameCount)
        .filter((frameCount) => frameCount > 0),
    );
    if (motionCadence !== null) {
      // The one-LED motion clock excludes stationary dwell, while dense samples
      // retain every upstream pose used to draw the trail.
      referenceFrameCountByRunIndex.set(runIndex, Math.max(motionCadence, 1));
      continue;
    }

    const event = runEvents[0];
    const activeFrameCount = Math.max(
      event.runEndFrameExclusive - event.runStartFrame,
      1,
    );
    const kernelUnitCount = (kernel.slots.length * kernel.noteLengthRatio)
      + (Math.max(kernel.slots.length - 1, 0) * kernel.gapRatio);
    referenceFrameCountByRunIndex.set(
      runIndex,
      kernelUnitCount > 0
        ? activeFrameCount / kernelUnitCount
        : activeFrameCount,
    );
  }

  return referenceFrameCountByRunIndex;
};

const toFirstSampleFrame = (
  frame: number,
): number => Math.max(Math.ceil(frame - COLOR_AGE_EPSILON), 0);

const buildEventWrites = (
  events: ReadonlyArray<GeometryStateEvent>,
  kernel: CompiledColorAgeKernel,
): ColorAgeWrite[] => {
  const writes: ColorAgeWrite[] = [];
  const referenceFrameCountByRunIndex = resolveReferenceFrameCountByRunIndex(
    events,
    kernel,
  );
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    const referenceFrameCount = referenceFrameCountByRunIndex.get(event.runIndex) ?? 1;
    const requestedNoteDurationFrames = Math.max(
      referenceFrameCount * kernel.noteLengthRatio,
      1,
    );
    const gapDurationFrames = referenceFrameCount * kernel.gapRatio;
    const slotStrideFrames = requestedNoteDurationFrames + gapDurationFrames;
    const nextEvent = events[eventIndex + 1];
    const stateEndFrame = nextEvent?.runIndex === event.runIndex
      ? nextEvent.frameIndex
      : event.runEndFrameExclusive;
    const stateFrameCount = Math.max(stateEndFrame - event.frameIndex, 1);
    // A geometry snapshot already supplies one visible stroke. The first slot,
    // and every band separated by an explicit Gap, therefore uses only the
    // centerline sweep above 100%. Gap 0 keeps dense history bands so diagonal
    // trails retain their existing lattice continuity.
    const visibleWriteDurationFrames = Math.min(
      stateFrameCount,
      referenceFrameCount,
      requestedNoteDurationFrames,
    ) + Math.max(
      requestedNoteDurationFrames - referenceFrameCount,
      0,
    );

    const eventWrites: ColorAgeWrite[] = [];
    for (const slot of kernel.slots) {
      const isFirstSlot = slot.slotIndex === 0;
      const usesFootprintAdjustedBand = isFirstSlot || kernel.gapRatio > 0;
      const rawStartFrame = isFirstSlot
        ? event.frameIndex
        : kernel.gapRatio > 0
          ? event.frameIndex + (slot.slotIndex * slotStrideFrames)
          : event.frameIndex
            + visibleWriteDurationFrames
            + ((slot.slotIndex - 1) * requestedNoteDurationFrames);
      const rawEndFrameExclusive = rawStartFrame + (
        usesFootprintAdjustedBand
          ? visibleWriteDurationFrames
          : requestedNoteDurationFrames
      );
      const startFrame = toFirstSampleFrame(rawStartFrame);
      const endFrameExclusive = Math.max(
        toFirstSampleFrame(rawEndFrameExclusive),
        startFrame + 1,
      );
      eventWrites.push({
        event,
        startFrame,
        endFrameExclusive,
        velocity: slot.velocity,
      });
    }
    const finalWrite = eventWrites[eventWrites.length - 1];
    if (
      finalWrite
      && finalWrite.startFrame < stateEndFrame
      && finalWrite.endFrameExclusive < stateEndFrame
    ) {
      finalWrite.endFrameExclusive = stateEndFrame;
    }
    writes.push(...eventWrites);
  }
  return writes;
};

const mergePlaybackWindow = (
  windows: Map<string, { start: number; end: number }>,
  originId: string,
  start: number,
  end: number,
): void => {
  const current = windows.get(originId);
  if (current) {
    current.start = Math.min(current.start, start);
    current.end = Math.max(current.end, end);
  } else {
    windows.set(originId, { start, end });
  }
};

export const materializeColorTimeline = (
  input: ColorTimelineMaterializationInput,
): ColorTimelineMaterializationResult => {
  const writes: ColorAgeWrite[] = [];
  const playbackWindowByOriginId = new Map<string, { start: number; end: number }>();
  let outputEndFrameExclusive = input.sourceTimeline.frames.length;
  const eventsByOriginId = extractGeometryEventTracks({
    timeline: input.sourceTimeline,
    targetOriginIds: input.targetOriginIds,
    frameWindow: input.sourceFrameWindow,
  });

  for (const originId of input.targetOriginIds) {
    const frameWindow = input.sourceFrameWindow;
    if (frameWindow.endFrameExclusive <= frameWindow.startFrame) {
      continue;
    }

    const events = eventsByOriginId.get(originId) ?? [];
    const originWrites = buildEventWrites(events, input.kernel);
    for (const write of originWrites) {
      writes.push(write);
      outputEndFrameExclusive = Math.max(outputEndFrameExclusive, write.endFrameExclusive);
      mergePlaybackWindow(
        playbackWindowByOriginId,
        originId,
        write.startFrame * input.sourceTimeline.sampleStepBeats,
        write.endFrameExclusive * input.sourceTimeline.sampleStepBeats,
      );
    }
  }

  const outputEndBeat = Math.max(
    input.sourceTimeline.timeDomainEndBeat,
    outputEndFrameExclusive * input.sourceTimeline.sampleStepBeats,
  );
  const timelineStage = beginTimelineStage(input.sourceTimeline, outputEndBeat);
  if (
    input.sourceFrameWindow.startFrame === 0
    && input.sourceFrameWindow.endFrameExclusive >= input.sourceTimeline.frames.length
  ) {
    deleteOrigins(timelineStage, input.targetOriginIds);
  }
  for (
    let frameIndex = input.sourceFrameWindow.startFrame;
    frameIndex < input.sourceFrameWindow.endFrameExclusive;
    frameIndex += 1
  ) {
    const retainedStrokes = timelineStage.frames[frameIndex]?.strokes.filter(
      (stroke) => !input.targetOriginIds.has(stroke.polyline.originId),
    ) ?? [];
    setFrameStrokes(timelineStage, frameIndex, retainedStrokes);
  }

  for (const write of writes) {
    for (const stroke of write.event.strokes) {
      addStrokeToFrameRange(
        timelineStage,
        write.startFrame,
        write.endFrameExclusive,
        colorizeEventStroke(stroke, write.velocity, input.writeOrder),
      );
    }
  }

  return {
    timeline: completeTimelineStage(timelineStage),
    playbackWindowByOriginId,
  };
};
