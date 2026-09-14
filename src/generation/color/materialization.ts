import type { GeometryStateEvent } from '../geometry/event-track';
import { extractGeometryEventTracks } from '../geometry/event-track';
import {
  addStrokeToFrameRange,
  beginTimelineStage,
  removeOriginStrokes,
} from '../timeline';
import type {
  ColorLayer,
  GeometryStroke,
  GeometryTimeline,
} from '../types';
import type { CompiledColorAgeKernel } from './types';

interface ColorTimelineMaterializationInput {
  sourceTimeline: GeometryTimeline;
  targetOriginIds: ReadonlySet<string>;
  kernel: CompiledColorAgeKernel;
  writeOrder: number;
}

interface ColorTimelineMaterializationResult {
  timeline: GeometryTimeline;
  playbackExtentByOriginId: ReadonlyMap<string, {
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

const colorizeEventStroke = (
  stroke: GeometryStroke,
  velocity: number,
  layer: ColorLayer,
  event: GeometryStateEvent,
  writeOrder: number,
): Omit<GeometryStroke, 'writeId'> => ({
  polyline: {
    ...stroke.polyline,
    velocity,
  },
  originGroupId: stroke.originGroupId,
  writeOrder,
  masks: stroke.masks,
  pathId: stroke.pathId,
  colorBinding: {
    layer, sourceFrame: event.frameIndex, sourceEndFrameExclusive: event.endFrameExclusive,
    sourceOrder: stroke.writeId,
  },
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

const toFirstSampleIndex = (
  frame: number,
): number => Math.ceil(frame - COLOR_AGE_EPSILON);

const resolveReferenceSpan = (
  events: ReadonlyArray<GeometryStateEvent>,
  kernel: CompiledColorAgeKernel,
): number => {
  const motionCadences = events.flatMap((event) => event.motionUnitFrameCounts);
  // Retain every pose; the representative one-LED cadence only sets the unit.
  return motionCadences.length > 0
    ? median(motionCadences)
    : (events[0].runEndFrameExclusive - events[0].runStartFrame)
      / kernel.sequenceEndUnit;
};

const createMotionSampleClock = (
  events: ReadonlyArray<GeometryStateEvent>,
): ((position: number) => number) => {
  const lastEventIndex = events.length - 1;
  const sourceEndFrame = events[lastEventIndex].endFrameExclusive;
  return (position) => {
    // The clock advances only on a new pose. A shared fractional boundary is
    // sampled once, so sub-sample slots may be empty rather than overlap.
    const sampleIndex = toFirstSampleIndex(position);
    if (sampleIndex <= lastEventIndex) {
      return events[sampleIndex].frameIndex;
    }
    // After the final held pose, consume history at one unit per output sample.
    return sourceEndFrame + sampleIndex - lastEventIndex - 1;
  };
};

function* iterateEventWrites(
  events: ReadonlyArray<GeometryStateEvent>,
  kernel: CompiledColorAgeKernel,
): Generator<ColorAgeWrite> {
  for (const runEvents of groupEventsByRunIndex(events).values()) {
    const referenceSpan = resolveReferenceSpan(runEvents, kernel);
    const toOutputFrame = runEvents.length > 1
      ? createMotionSampleClock(runEvents)
      : (position: number) => toFirstSampleIndex(runEvents[0].frameIndex + position);

    const slotCoverage = kernel.coverageIntervals.flatMap((interval) => {
      const intervalUnits = interval.endUnitExclusive - interval.startUnit;
      const requestedSpan = intervalUnits * referenceSpan;
      // The source stroke supplies its own footprint. Add only the sweep beyond
      // one motion unit, once per connected interval rather than once per color.
      // Static sources use time alone; they have no motion footprint to subtract.
      const coverageSpan = runEvents.length > 1
        ? Math.min(requestedSpan, referenceSpan, 1)
          + Math.max(requestedSpan - referenceSpan, 0)
        : requestedSpan;
      const coverageStart = interval.startUnit * referenceSpan;
      const toCoveragePosition = (unit: number) => coverageStart
        + ((unit - interval.startUnit) / intervalUnits * coverageSpan);
      return interval.slots.map((slot) => ({
        slot,
        startPosition: toCoveragePosition(slot.startUnit),
        endPosition: toCoveragePosition(slot.endUnitExclusive),
      }));
    });

    for (let eventIndex = 0; eventIndex < runEvents.length; eventIndex += 1) {
      for (const { slot, startPosition, endPosition } of slotCoverage) {
        yield {
          event: runEvents[eventIndex],
          startFrame: toOutputFrame(eventIndex + startPosition),
          endFrameExclusive: toOutputFrame(eventIndex + endPosition),
          velocity: slot.velocity,
        };
      }
    }
  }
}

export const materializeColorTimeline = (
  input: ColorTimelineMaterializationInput,
): ColorTimelineMaterializationResult => {
  const writes: Array<ColorAgeWrite & { layer: ColorLayer }> = [];
  const playbackExtentByOriginId = new Map<string, { start: number; end: number }>();
  let outputEndFrameExclusive = input.sourceTimeline.frameCount;
  const eventsByOriginId = extractGeometryEventTracks({
    timeline: input.sourceTimeline,
    targetOriginIds: input.targetOriginIds,
    frameWindow: {
      startFrame: 0,
      endFrameExclusive: input.sourceTimeline.frameCount,
    },
  });

  let nextLayerOrder = input.sourceTimeline.nextWriteId;
  for (const originId of input.targetOriginIds) {
    const events = eventsByOriginId.get(originId) ?? [];
    const layer: ColorLayer = { order: [nextLayerOrder++] };
    let originStart = Infinity;
    let originEnd = -Infinity;
    for (const write of iterateEventWrites(events, input.kernel)) {
      writes.push({ ...write, layer });
      originStart = Math.min(originStart, write.startFrame * input.sourceTimeline.sampleStepBeats);
      originEnd = Math.max(originEnd, write.endFrameExclusive * input.sourceTimeline.sampleStepBeats);
      outputEndFrameExclusive = Math.max(outputEndFrameExclusive, write.endFrameExclusive);
    }
    if (originStart < Infinity) {
      playbackExtentByOriginId.set(originId, { start: originStart, end: originEnd });
    }
  }

  const outputEndBeat = Math.max(
    input.sourceTimeline.timeDomainEndBeat,
    outputEndFrameExclusive * input.sourceTimeline.sampleStepBeats,
  );
  const timelineStage = beginTimelineStage(input.sourceTimeline, outputEndBeat);
  removeOriginStrokes(timelineStage, input.targetOriginIds, timelineStage.frameCount);

  for (const write of writes) {
    for (const stroke of write.event.strokes) {
      addStrokeToFrameRange(
        timelineStage,
        write.startFrame,
        write.endFrameExclusive,
        colorizeEventStroke(
          stroke,
          write.velocity,
          write.layer,
          write.event,
          input.writeOrder,
        ),
      );
    }
  }

  return {
    timeline: timelineStage,
    playbackExtentByOriginId,
  };
};
