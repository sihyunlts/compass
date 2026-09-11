import { IDENTITY_AFFINE } from '../../core/geometry';
import { NOTE_SAMPLES_PER_BEAT } from '../../core/pipeline/constants';
import type { BeatRange } from '../analysis/types';
import type {
  GeometryPlacement,
  GeometryMask,
  GeometryStroke,
  GeometryTimeline,
} from '../types';

export const DEFAULT_SAMPLE_STEP_BEATS = 1 / NOTE_SAMPLES_PER_BEAT;

export const toFrameCount = (
  endBeat: number,
  sampleStepBeats: number,
): number => {
  if (!Number.isFinite(endBeat) || endBeat <= 0 || !Number.isFinite(sampleStepBeats) || sampleStepBeats <= 0) {
    return NOTE_SAMPLES_PER_BEAT;
  }

  return Math.max(Math.ceil(endBeat / sampleStepBeats), 1);
};

export const createEmptyTimeline = (
  sampleStepBeats = DEFAULT_SAMPLE_STEP_BEATS,
  endBeat = 1,
): GeometryTimeline => ({
  sampleStepBeats,
  timeDomainEndBeat: Math.max(endBeat, 1),
  frameCount: toFrameCount(Math.max(endBeat, 1), sampleStepBeats),
  placements: [],
  originGroupIdByOriginId: new Map(),
  nextWriteId: 1,
});

export const beginTimelineStage = (
  sourceTimeline: GeometryTimeline,
  endBeat = sourceTimeline.timeDomainEndBeat,
): GeometryTimeline => {
  const safeEndBeat = Number.isFinite(endBeat) && endBeat > 0 ? endBeat : 1;
  const frameCount = toFrameCount(safeEndBeat, sourceTimeline.sampleStepBeats);
  const placements: GeometryPlacement[] = [];
  for (const placement of sourceTimeline.placements) {
    if (placement.startFrame >= frameCount) continue;
    placements.push(placement.endFrameExclusive <= frameCount ? placement : {
      ...placement,
      endFrameExclusive: frameCount,
    });
  }
  return {
    sampleStepBeats: sourceTimeline.sampleStepBeats,
    timeDomainEndBeat: safeEndBeat,
    frameCount,
    placements,
    originGroupIdByOriginId: new Map(sourceTimeline.originGroupIdByOriginId),
    nextWriteId: sourceTimeline.nextWriteId,
  };
};

export const ensureTimelineFrameCount = (
  timeline: GeometryTimeline,
  minEndBeat: number,
): void => {
  const safeEndBeat = Number.isFinite(minEndBeat) && minEndBeat > 0 ? minEndBeat : 1;
  timeline.frameCount = Math.max(timeline.frameCount, toFrameCount(safeEndBeat, timeline.sampleStepBeats));
  timeline.timeDomainEndBeat = Math.max(timeline.timeDomainEndBeat, safeEndBeat);
};

export interface FrameWindow {
  startFrame: number;
  endFrameExclusive: number;
}

export const toFrameWindow = (
  range: BeatRange,
  sampleStepBeats: number,
  frameCount: number,
): FrameWindow => {
  if (!Number.isFinite(sampleStepBeats) || sampleStepBeats <= 0 || frameCount <= 0) {
    return {
      startFrame: 0,
      endFrameExclusive: 0,
    };
  }

  const safeStart = Number.isFinite(range.start) ? Math.max(range.start, 0) : 0;
  const safeEnd = Number.isFinite(range.end) ? Math.max(range.end, safeStart) : safeStart;
  const startFrame = Math.min(
    Math.max(Math.floor(safeStart / sampleStepBeats), 0),
    frameCount,
  );
  const endFrameExclusive = Math.min(
    Math.max(Math.ceil(safeEnd / sampleStepBeats), startFrame),
    frameCount,
  );

  return {
    startFrame,
    endFrameExclusive,
  };
};

export const addExistingStrokeToFrameRange = (
  timeline: GeometryTimeline,
  startFrame: number,
  endFrameExclusive: number,
  stroke: GeometryStroke,
): void => {
  const start = Math.min(Math.max(Math.trunc(startFrame), 0), timeline.frameCount);
  const end = Math.min(Math.max(Math.trunc(endFrameExclusive), start), timeline.frameCount);
  if (end <= start) return;
  timeline.placements.push({ stroke, startFrame: start, endFrameExclusive: end });
  timeline.originGroupIdByOriginId.set(stroke.polyline.originId, stroke.originGroupId);
  timeline.nextWriteId = Math.max(timeline.nextWriteId, stroke.writeId + 1);
};

export const addStrokeToFrameRange = (
  timeline: GeometryTimeline,
  startFrame: number,
  endFrameExclusive: number,
  stroke: Omit<GeometryStroke, 'writeId' | 'masks'> & {
    masks?: ReadonlyArray<GeometryMask>;
  },
): void => {
  addExistingStrokeToFrameRange(timeline, startFrame, endFrameExclusive, {
    ...stroke,
    writeId: timeline.nextWriteId,
    masks: stroke.masks ?? [],
  });
};

export const addStrokeToFrame = (
  timeline: GeometryTimeline,
  frameIndex: number,
  stroke: Omit<GeometryStroke, 'writeId' | 'masks'> & {
    masks?: ReadonlyArray<GeometryMask>;
  },
): void => {
  const frame = Math.min(Math.max(frameIndex, 0), timeline.frameCount - 1);
  addStrokeToFrameRange(timeline, frame, frame + 1, stroke);
};

export const unregisterTimelineOrigins = (
  timeline: GeometryTimeline,
  originIds: Iterable<string>,
): void => {
  for (const originId of originIds) timeline.originGroupIdByOriginId.delete(originId);
};

export const removeOriginStrokes = (
  timeline: GeometryTimeline,
  targetOriginIds: ReadonlySet<string>,
  frameCount: number,
): void => {
  unregisterTimelineOrigins(timeline, targetOriginIds);
  const placements: GeometryPlacement[] = [];
  for (const placement of timeline.placements) {
    if (!targetOriginIds.has(placement.stroke.polyline.originId) || placement.startFrame >= frameCount) {
      placements.push(placement);
    } else if (placement.endFrameExclusive > frameCount) {
      placements.push({ ...placement, startFrame: frameCount });
    }
  }
  timeline.placements = placements;
};

/** Emits maximal spans with the same ordered set of active placements. */
export function* iterateTimelineSpans(
  timeline: GeometryTimeline,
  frameWindow: FrameWindow = { startFrame: 0, endFrameExclusive: timeline.frameCount },
  targetOriginIds?: ReadonlySet<string>,
): Generator<FrameWindow & { strokes: ReadonlyArray<GeometryStroke> }> {
  const placements = targetOriginIds
    ? timeline.placements.filter(({ stroke }) => targetOriginIds.has(stroke.polyline.originId))
    : timeline.placements;
  const starts = new Map<number, number[]>();
  const ends = new Map<number, number[]>();
  const addBoundary = (boundaries: Map<number, number[]>, frame: number, index: number): void => {
    const indices = boundaries.get(frame);
    if (indices) indices.push(index);
    else boundaries.set(frame, [index]);
  };
  placements.forEach((placement, index) => {
    const start = Math.max(placement.startFrame, frameWindow.startFrame);
    const end = Math.min(placement.endFrameExclusive, frameWindow.endFrameExclusive);
    if (end > start) {
      addBoundary(starts, start, index);
      addBoundary(ends, end, index);
    }
  });
  // Bits enumerate active placements in insertion order without sorting each frame.
  const active = new Uint32Array(Math.ceil(placements.length / 32));
  const boundaries = Array.from(new Set([
    frameWindow.startFrame, frameWindow.endFrameExclusive, ...starts.keys(), ...ends.keys(),
  ])).sort((left, right) => left - right);
  for (let boundaryIndex = 0; boundaryIndex < boundaries.length - 1; boundaryIndex += 1) {
    const frameIndex = boundaries[boundaryIndex];
    for (const index of ends.get(frameIndex) ?? []) active[index >>> 5] &= ~(1 << (index & 31));
    for (const index of starts.get(frameIndex) ?? []) active[index >>> 5] |= 1 << (index & 31);
    const strokes: GeometryStroke[] = [];
    for (let wordIndex = 0; wordIndex < active.length; wordIndex += 1) {
      let word = active[wordIndex];
      while (word !== 0) {
        const bit = 31 - Math.clz32(word & -word);
        strokes.push(placements[wordIndex * 32 + bit].stroke);
        word = (word & (word - 1)) >>> 0;
      }
    }
    yield {
      startFrame: frameIndex,
      endFrameExclusive: boundaries[boundaryIndex + 1],
      strokes,
    };
  }
}

export function* iterateTimelineFrames(
  timeline: GeometryTimeline,
  frameWindow?: FrameWindow,
  targetOriginIds?: ReadonlySet<string>,
): Generator<{ frameIndex: number; strokes: ReadonlyArray<GeometryStroke> }> {
  for (const span of iterateTimelineSpans(timeline, frameWindow, targetOriginIds)) {
    for (let frameIndex = span.startFrame; frameIndex < span.endFrameExclusive; frameIndex += 1) {
      yield { frameIndex, strokes: span.strokes };
    }
  }
}

export const groupPlacementsByOrigin = (
  timeline: GeometryTimeline,
  targetOriginIds: ReadonlySet<string>,
): Map<string, GeometryPlacement[]> => {
  const byOrigin = new Map<string, GeometryPlacement[]>();
  for (const placement of timeline.placements) {
    const originId = placement.stroke.polyline.originId;
    if (!targetOriginIds.has(originId)) continue;
    const placements = byOrigin.get(originId);
    if (placements) placements.push(placement);
    else byOrigin.set(originId, [placement]);
  }
  return byOrigin;
};

export const createIdentityMask = (
  contains: GeometryMask['contains'],
): GeometryMask => ({
  contains,
  inverseTransform: { ...IDENTITY_AFFINE },
});
