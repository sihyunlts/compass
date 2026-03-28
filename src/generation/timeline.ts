import { IDENTITY_AFFINE } from '../core/geometry';
import { NOTE_SAMPLES_PER_BEAT } from '../core/pipeline/constants';
import type { BeatRange } from './analysis/types';
import type {
  GeometryMask,
  GeometryStroke,
  GeometryTimeline,
} from './types';

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

const createEmptyFrames = (count: number): GeometryTimeline['frames'] =>
  Array.from({ length: Math.max(count, 1) }, () => ({ strokes: [] as GeometryStroke[] }));

export const createEmptyTimeline = (
  sampleStepBeats = DEFAULT_SAMPLE_STEP_BEATS,
  endBeat = 1,
): GeometryTimeline => ({
  sampleStepBeats,
  timeDomainEndBeat: Math.max(endBeat, 1),
  frames: createEmptyFrames(toFrameCount(Math.max(endBeat, 1), sampleStepBeats)),
  nextWriteId: 1,
});

const cloneMask = (mask: GeometryMask): GeometryMask => ({
  contains: mask.contains,
  inverseTransform: { ...mask.inverseTransform },
});

export const cloneStroke = (stroke: GeometryStroke): GeometryStroke => ({
  polyline: {
    ...stroke.polyline,
    points: stroke.polyline.points.map((point) => ({ ...point })),
    clipStack: stroke.polyline.clipStack.map((clip) => ({
      ...clip,
      inverseTransform: { ...clip.inverseTransform },
    })),
  },
  originGroupId: stroke.originGroupId,
  writeOrder: stroke.writeOrder,
  writeId: stroke.writeId,
  masks: stroke.masks.map(cloneMask),
});

export const cloneTimeline = (timeline: GeometryTimeline): GeometryTimeline => ({
  sampleStepBeats: timeline.sampleStepBeats,
  timeDomainEndBeat: timeline.timeDomainEndBeat,
  frames: timeline.frames.map((frame) => ({
    strokes: frame.strokes.map(cloneStroke),
  })),
  nextWriteId: timeline.nextWriteId,
});

export const ensureTimelineFrameCount = (
  timeline: GeometryTimeline,
  minEndBeat: number,
): void => {
  const safeEndBeat = Number.isFinite(minEndBeat) && minEndBeat > 0
    ? minEndBeat
    : 1;
  const requiredFrameCount = toFrameCount(safeEndBeat, timeline.sampleStepBeats);

  while (timeline.frames.length < requiredFrameCount) {
    timeline.frames.push({ strokes: [] });
  }

  if (safeEndBeat > timeline.timeDomainEndBeat) {
    timeline.timeDomainEndBeat = safeEndBeat;
  }
};

export const clampFrameIndex = (
  frameIndex: number,
  frameCount: number,
): number => {
  if (frameCount <= 0) {
    return 0;
  }

  return Math.min(Math.max(frameIndex, 0), frameCount - 1);
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

export const addStrokeToFrame = (
  timeline: GeometryTimeline,
  frameIndex: number,
  stroke: Omit<GeometryStroke, 'writeId' | 'masks'> & { masks?: GeometryMask[] },
): void => {
  const safeFrameIndex = clampFrameIndex(frameIndex, timeline.frames.length);
  timeline.frames[safeFrameIndex].strokes.push({
    ...stroke,
    writeId: timeline.nextWriteId,
    masks: stroke.masks?.map(cloneMask) ?? [],
  });
  timeline.nextWriteId += 1;
};

export const finalizeTimeline = (
  timeline: GeometryTimeline,
): GeometryTimeline => {
  let lastActiveIndex = -1;

  for (let index = timeline.frames.length - 1; index >= 0; index -= 1) {
    if (timeline.frames[index].strokes.length > 0) {
      lastActiveIndex = index;
      break;
    }
  }

  const endBeat = lastActiveIndex >= 0
    ? (lastActiveIndex + 1) * timeline.sampleStepBeats
    : 1;
  const frameCount = toFrameCount(Math.max(endBeat, 1), timeline.sampleStepBeats);

  return {
    sampleStepBeats: timeline.sampleStepBeats,
    timeDomainEndBeat: Math.max(endBeat, 1),
    frames: timeline.frames.slice(0, frameCount).map((frame) => ({
      strokes: frame.strokes.map(cloneStroke),
    })),
    nextWriteId: timeline.nextWriteId,
  };
};

export const createIdentityMask = (
  contains: GeometryMask['contains'],
): GeometryMask => ({
  contains,
  inverseTransform: { ...IDENTITY_AFFINE },
});
