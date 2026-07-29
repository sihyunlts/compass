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
  playbackEndFrameExclusive: number;
  colorAgeBandIndex: number;
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
  colorAgeBandIndex: number | undefined,
  colorAgeBandCount: number | undefined,
  writeOrder: number,
): Omit<GeometryStroke, 'writeId'> => ({
  polyline: {
    ...stroke.polyline,
    velocity,
    colorAgeBandIndex,
    colorAgeBandCount,
    points: stroke.polyline.points,
    clipStack: stroke.polyline.clipStack,
  },
  originGroupId: stroke.originGroupId,
  writeOrder,
  masks: stroke.masks.map(cloneMask),
});

const median = (
  values: ReadonlyArray<number>,
): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

interface ColorEventTiming {
  positionByEvent: ReadonlyMap<GeometryStateEvent, number>;
  runEndPosition: number;
  toOutputFrame(position: number): number;
}

const groupEventsByRunIndex = (
  events: ReadonlyArray<GeometryStateEvent>,
): ReadonlyMap<number, GeometryStateEvent[]> => {
  const eventsByRunIndex = new Map<number, GeometryStateEvent[]>();
  for (const event of events) {
    const runEvents = eventsByRunIndex.get(event.runIndex);
    if (runEvents) {
      runEvents.push(event);
    } else {
      eventsByRunIndex.set(event.runIndex, [event]);
    }
  }
  return eventsByRunIndex;
};

const createOutputFrameTiming = (
  events: ReadonlyArray<GeometryStateEvent>,
): ColorEventTiming => ({
  positionByEvent: new Map(events.map((event) => [event, event.frameIndex])),
  runEndPosition: events[0].runEndFrameExclusive,
  toOutputFrame: (position) => position,
});

const createMotionSampleTiming = (
  events: ReadonlyArray<GeometryStateEvent>,
): ColorEventTiming => {
  const positionByEvent = new Map(
    events.map((event, eventIndex) => [event, eventIndex]),
  );
  const lastEventIndex = events.length - 1;
  const firstFrame = events[0].frameIndex;
  const lastFrame = events[lastEventIndex].frameIndex;
  const frameStep = (lastFrame - firstFrame) / lastEventIndex;

  return {
    positionByEvent,
    runEndPosition: lastEventIndex
      + ((events[0].runEndFrameExclusive - lastFrame) / frameStep),
    toOutputFrame: (position) => {
      if (position >= lastEventIndex) {
        return lastFrame + ((position - lastEventIndex) * frameStep);
      }

      const startEventIndex = Math.floor(position);
      const startFrame = events[startEventIndex].frameIndex;
      const endFrame = events[startEventIndex + 1].frameIndex;
      return startFrame + ((endFrame - startFrame) * (position - startEventIndex));
    },
  };
};

const buildEventTimingByRunIndex = (
  eventsByRunIndex: ReadonlyMap<number, GeometryStateEvent[]>,
): ReadonlyMap<number, ColorEventTiming> => {
  return new Map(
    Array.from(eventsByRunIndex.entries(), ([runIndex, runEvents]) => {
      const hasMotionCadence = runEvents.some((event) => event.motionUnitFrameCount > 0);
      const timing = hasMotionCadence && runEvents.length > 1
        ? createMotionSampleTiming(runEvents)
        : createOutputFrameTiming(runEvents);
      return [runIndex, timing];
    }),
  );
};

const resolveReferenceSpanByRunIndex = (
  eventsByRunIndex: ReadonlyMap<number, GeometryStateEvent[]>,
  kernel: CompiledColorAgeKernel,
): ReadonlyMap<number, number> => {
  const referenceSpanByRunIndex = new Map<number, number>();
  for (const [runIndex, runEvents] of eventsByRunIndex.entries()) {
    const motionCadences = runEvents
      .map((event) => event.motionUnitFrameCount)
      .filter((frameCount) => frameCount > 0);
    if (motionCadences.length > 0) {
      // The one-LED motion clock excludes stationary dwell, while dense samples
      // retain every upstream pose used to draw the trail.
      referenceSpanByRunIndex.set(runIndex, median(motionCadences));
      continue;
    }

    const event = runEvents[0];
    const activeFrameCount = event.runEndFrameExclusive - event.runStartFrame;
    const kernelUnitCount = (kernel.slots.length * kernel.noteLengthRatio)
      + ((kernel.slots.length - 1) * kernel.gapRatio);
    referenceSpanByRunIndex.set(
      runIndex,
      activeFrameCount / kernelUnitCount,
    );
  }

  return referenceSpanByRunIndex;
};

const toFirstSampleFrame = (
  frame: number,
): number => Math.ceil(frame - COLOR_AGE_EPSILON);

const buildEventWrites = (
  events: ReadonlyArray<GeometryStateEvent>,
  kernel: CompiledColorAgeKernel,
): ColorAgeWrite[] => {
  const writes: ColorAgeWrite[] = [];
  const eventsByRunIndex = groupEventsByRunIndex(events);
  const referenceSpanByRunIndex = resolveReferenceSpanByRunIndex(
    eventsByRunIndex,
    kernel,
  );
  const eventTimingByRunIndex = buildEventTimingByRunIndex(eventsByRunIndex);
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    const timing = eventTimingByRunIndex.get(event.runIndex)!;
    const eventPosition = timing.positionByEvent.get(event)!;
    const referenceSpan = referenceSpanByRunIndex.get(event.runIndex)!;
    const requestedNoteDuration = Math.max(
      referenceSpan * kernel.noteLengthRatio,
      1,
    );
    const gapDuration = referenceSpan * kernel.gapRatio;
    const slotStride = requestedNoteDuration + gapDuration;
    const nextEvent = events[eventIndex + 1];
    const stateEndPosition = nextEvent?.runIndex === event.runIndex
      ? timing.positionByEvent.get(nextEvent)!
      : timing.runEndPosition;
    const stateSpan = stateEndPosition - eventPosition;
    // A geometry snapshot already supplies one visible stroke. The first slot,
    // and every band separated by an explicit Gap, therefore uses only the
    // centerline sweep above 100%. Gap 0 keeps dense history bands so diagonal
    // trails retain their existing lattice continuity.
    const visibleWriteDuration = Math.min(
      stateSpan,
      referenceSpan,
      requestedNoteDuration,
    ) + Math.max(
      requestedNoteDuration - referenceSpan,
      0,
    );

    const eventWrites: ColorAgeWrite[] = [];
    for (const slot of kernel.slots) {
      const isFirstSlot = slot.slotIndex === 0;
      const usesFootprintAdjustedBand = isFirstSlot || kernel.gapRatio > 0;
      const rawStartPosition = isFirstSlot
        ? eventPosition
        : kernel.gapRatio > 0
          ? eventPosition + (slot.slotIndex * slotStride)
          : eventPosition
            + visibleWriteDuration
            + ((slot.slotIndex - 1) * requestedNoteDuration);
      const rawEndPosition = rawStartPosition + (
        usesFootprintAdjustedBand
          ? visibleWriteDuration
          : requestedNoteDuration
      );
      const startFrame = toFirstSampleFrame(timing.toOutputFrame(rawStartPosition));
      const endFrameExclusive = Math.max(
        toFirstSampleFrame(timing.toOutputFrame(rawEndPosition)),
        startFrame + 1,
      );
      eventWrites.push({
        event,
        startFrame,
        endFrameExclusive,
        playbackEndFrameExclusive: Math.max(
          toFirstSampleFrame(timing.toOutputFrame(
            rawStartPosition + requestedNoteDuration,
          )),
          startFrame + 1,
        ),
        colorAgeBandIndex: slot.slotIndex,
        velocity: slot.velocity,
      });
    }
    const finalWrite = eventWrites[eventWrites.length - 1];
    const stateEndFrame = toFirstSampleFrame(
      timing.toOutputFrame(stateEndPosition),
    );
    if (finalWrite.endFrameExclusive < stateEndFrame) {
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
  const usesNearestColorBoundary = input.kernel.noteLengthRatio < 1;
  let outputEndFrameExclusive = input.sourceTimeline.frames.length;
  const eventsByOriginId = extractGeometryEventTracks({
    timeline: input.sourceTimeline,
    targetOriginIds: input.targetOriginIds,
    frameWindow: input.sourceFrameWindow,
  });

  for (const originId of input.targetOriginIds) {
    const events = eventsByOriginId.get(originId) ?? [];
    const originWrites = buildEventWrites(events, input.kernel);
    for (const write of originWrites) {
      writes.push(write);
      outputEndFrameExclusive = Math.max(
        outputEndFrameExclusive,
        write.playbackEndFrameExclusive,
      );
      mergePlaybackWindow(
        playbackWindowByOriginId,
        originId,
        write.startFrame * input.sourceTimeline.sampleStepBeats,
        write.playbackEndFrameExclusive * input.sourceTimeline.sampleStepBeats,
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
    const retainedStrokes = timelineStage.frames[frameIndex].strokes.filter(
      (stroke) => !input.targetOriginIds.has(stroke.polyline.originId),
    );
    setFrameStrokes(timelineStage, frameIndex, retainedStrokes);
  }

  for (const write of writes) {
    for (const stroke of write.event.strokes) {
      addStrokeToFrameRange(
        timelineStage,
        write.startFrame,
        write.endFrameExclusive,
        colorizeEventStroke(
          stroke,
          write.velocity,
          usesNearestColorBoundary ? write.colorAgeBandIndex : undefined,
          usesNearestColorBoundary ? input.kernel.slots.length : undefined,
          input.writeOrder,
        ),
      );
    }
  }

  return {
    timeline: completeTimelineStage(timelineStage),
    playbackWindowByOriginId,
  };
};
