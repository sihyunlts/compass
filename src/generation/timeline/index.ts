import { IDENTITY_AFFINE } from '../../core/geometry';
import { NOTE_SAMPLES_PER_BEAT } from '../../core/pipeline/constants';
import type { BeatRange } from '../analysis/types';
import type {
  GeometryFrame,
  GeometryMask,
  GeometrySample,
  GeometryStroke,
  GeometryTimingSample,
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

const createEmptyFrames = (count: number): GeometryTimeline['frames'] =>
  Array.from({ length: Math.max(count, 1) }, () => ({ strokes: [] as GeometryStroke[] }));

export const createEmptyTimeline = (
  sampleStepBeats = DEFAULT_SAMPLE_STEP_BEATS,
  endBeat = 1,
): GeometryTimeline => ({
  sampleStepBeats,
  timeDomainEndBeat: Math.max(endBeat, 1),
  frames: createEmptyFrames(toFrameCount(Math.max(endBeat, 1), sampleStepBeats)),
  originGroupIdByOriginId: new Map(),
  geometrySamplesByOriginId: new Map(),
  timingSamplesByOriginId: new Map(),
  nextWriteId: 1,
});

interface TimelineStageBuffer extends GeometryTimeline {
  readonly sourceFrames: ReadonlyArray<GeometryFrame>;
}

const cloneMask = (mask: GeometryMask): GeometryMask => ({
  contains: mask.contains,
  inverseTransform: { ...mask.inverseTransform },
});

const cloneStroke = (stroke: GeometryStroke): GeometryStroke => ({
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

const isTimelineStageBuffer = (
  timeline: GeometryTimeline | TimelineStageBuffer,
): timeline is TimelineStageBuffer => 'sourceFrames' in timeline;

const createFramesFromBase = (
  sourceFrames: ReadonlyArray<GeometryFrame>,
  frameCount: number,
): GeometryTimeline['frames'] => Array.from(
  { length: frameCount },
  (_, index) => sourceFrames[index] ?? { strokes: [] as GeometryStroke[] },
);

const cloneTimingSamplesByOriginId = (
  timingSamplesByOriginId: ReadonlyMap<string, ReadonlyArray<GeometryTimingSample>>,
): Map<string, GeometryTimingSample[]> => new Map(
  Array.from(timingSamplesByOriginId.entries(), ([originId, samples]) => [
    originId,
    samples.map((sample) => ({
      beat: sample.beat,
      strokes: sample.strokes.map((stroke) => ({ ...stroke })),
    })),
  ]),
);

const cloneGeometrySamplesByOriginId = (
  geometrySamplesByOriginId: ReadonlyMap<string, ReadonlyArray<GeometrySample>>,
): Map<string, GeometrySample[]> => new Map(
  Array.from(geometrySamplesByOriginId.entries(), ([originId, samples]) => [
    originId,
    samples.map((sample) => ({
      beat: sample.beat,
      strokes: sample.strokes.map(cloneStroke),
    })),
  ]),
);

const registerStrokeOrigin = (
  timeline: GeometryTimeline | TimelineStageBuffer,
  stroke: Pick<GeometryStroke, 'polyline' | 'originGroupId'>,
): void => {
  timeline.originGroupIdByOriginId.set(stroke.polyline.originId, stroke.originGroupId);
};

const addGeometrySampleStroke = (
  timeline: GeometryTimeline | TimelineStageBuffer,
  originId: string,
  beat: number,
  stroke: GeometryStroke,
): void => {
  let samples = timeline.geometrySamplesByOriginId.get(originId);
  if (!samples) {
    samples = [];
    timeline.geometrySamplesByOriginId.set(originId, samples);
  }

  let sample = samples.find((candidate) => candidate.beat === beat);
  if (!sample) {
    sample = {
      beat,
      strokes: [],
    };
    samples.push(sample);
  }

  sample.strokes.push(stroke);
};

const addTimingSampleStrokeToTimeline = (
  timeline: GeometryTimeline | TimelineStageBuffer,
  originId: string,
  beat: number,
  stroke: GeometryTimingSample['strokes'][number],
): void => {
  let samples = timeline.timingSamplesByOriginId.get(originId);
  if (!samples) {
    samples = [];
    timeline.timingSamplesByOriginId.set(originId, samples);
  }

  let sample = samples.find((candidate) => candidate.beat === beat);
  if (!sample) {
    sample = {
      beat,
      strokes: [],
    };
    samples.push(sample);
  }

  sample.strokes.push({ ...stroke });
};

const addStrokeTimingSample = (
  timeline: GeometryTimeline | TimelineStageBuffer,
  beat: number,
  stroke: GeometryStroke,
): void => {
  addTimingSampleStrokeToTimeline(
    timeline,
    stroke.polyline.originId,
    beat,
    {
      id: String(stroke.writeId),
      activationStepBeats: stroke.polyline.activationStepBeats,
      activationSignature: stroke.polyline.activationSignature,
    },
  );
};

export const beginTimelineStage = (
  sourceTimeline: GeometryTimeline,
  endBeat = sourceTimeline.timeDomainEndBeat,
): TimelineStageBuffer => {
  const safeEndBeat = Number.isFinite(endBeat) && endBeat > 0
    ? endBeat
    : 1;
  const frameCount = toFrameCount(safeEndBeat, sourceTimeline.sampleStepBeats);

  return {
    sampleStepBeats: sourceTimeline.sampleStepBeats,
    timeDomainEndBeat: safeEndBeat,
    frames: createFramesFromBase(sourceTimeline.frames, frameCount),
    originGroupIdByOriginId: new Map(sourceTimeline.originGroupIdByOriginId),
    geometrySamplesByOriginId: cloneGeometrySamplesByOriginId(sourceTimeline.geometrySamplesByOriginId),
    timingSamplesByOriginId: cloneTimingSamplesByOriginId(sourceTimeline.timingSamplesByOriginId),
    nextWriteId: sourceTimeline.nextWriteId,
    sourceFrames: sourceTimeline.frames,
  };
};

export const ensureTimelineFrameCount = (
  timeline: GeometryTimeline | TimelineStageBuffer,
  minEndBeat: number,
): void => {
  const safeEndBeat = Number.isFinite(minEndBeat) && minEndBeat > 0
    ? minEndBeat
    : 1;
  const requiredFrameCount = toFrameCount(safeEndBeat, timeline.sampleStepBeats);

  while (timeline.frames.length < requiredFrameCount) {
    if (isTimelineStageBuffer(timeline)) {
      timeline.frames.push(timeline.sourceFrames[timeline.frames.length] ?? { strokes: [] });
      continue;
    }

    timeline.frames.push({ strokes: [] });
  }

  if (safeEndBeat > timeline.timeDomainEndBeat) {
    timeline.timeDomainEndBeat = safeEndBeat;
  }
};

const getWritableFrame = (
  timeline: GeometryTimeline | TimelineStageBuffer,
  frameIndex: number,
): GeometryFrame => {
  const safeFrameIndex = clampFrameIndex(frameIndex, timeline.frames.length);
  const frame = timeline.frames[safeFrameIndex];

  if (isTimelineStageBuffer(timeline) && frame === timeline.sourceFrames[safeFrameIndex]) {
    const writableFrame: GeometryFrame = {
      strokes: [...frame.strokes],
    };
    timeline.frames[safeFrameIndex] = writableFrame;
    return writableFrame;
  }

  return frame;
};

export const setFrameStrokes = (
  timeline: GeometryTimeline | TimelineStageBuffer,
  frameIndex: number,
  strokes: ReadonlyArray<GeometryStroke>,
): void => {
  const safeFrameIndex = clampFrameIndex(frameIndex, timeline.frames.length);
  timeline.frames[safeFrameIndex] = {
    strokes: [...strokes],
  };
};

const clampFrameIndex = (
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
  timeline: GeometryTimeline | TimelineStageBuffer,
  frameIndex: number,
  stroke: Omit<GeometryStroke, 'writeId' | 'masks'> & { masks?: GeometryMask[] },
): void => {
  const writableFrame = getWritableFrame(timeline, frameIndex);
  const nextStroke = {
    ...stroke,
    writeId: timeline.nextWriteId,
    masks: stroke.masks?.map(cloneMask) ?? [],
  };
  writableFrame.strokes.push(nextStroke);
  registerStrokeOrigin(timeline, nextStroke);
  addStrokeTimingSample(
    timeline,
    frameIndex * timeline.sampleStepBeats,
    nextStroke,
  );
  addGeometrySampleStroke(
    timeline,
    nextStroke.polyline.originId,
    frameIndex * timeline.sampleStepBeats,
    nextStroke,
  );
  timeline.nextWriteId += 1;
};

export const addStrokeToFrames = (
  timeline: GeometryTimeline | TimelineStageBuffer,
  frameIndexes: ReadonlyArray<number>,
  stroke: Omit<GeometryStroke, 'writeId' | 'masks'> & { masks?: GeometryMask[] },
): void => {
  if (frameIndexes.length === 0) {
    return;
  }

  const sharedStroke: GeometryStroke = {
    ...stroke,
    writeId: timeline.nextWriteId,
    masks: stroke.masks?.map(cloneMask) ?? [],
  };
  timeline.nextWriteId += 1;
  registerStrokeOrigin(timeline, sharedStroke);

  for (const frameIndex of frameIndexes) {
    getWritableFrame(timeline, frameIndex).strokes.push(sharedStroke);
    addStrokeTimingSample(
      timeline,
      frameIndex * timeline.sampleStepBeats,
      sharedStroke,
    );
    addGeometrySampleStroke(
      timeline,
      sharedStroke.polyline.originId,
      frameIndex * timeline.sampleStepBeats,
      sharedStroke,
    );
  }
};

export const addExistingStrokeToFrame = (
  timeline: GeometryTimeline | TimelineStageBuffer,
  frameIndex: number,
  stroke: GeometryStroke,
): void => {
  const writableFrame = getWritableFrame(timeline, frameIndex);
  const nextStroke = cloneStroke(stroke);
  writableFrame.strokes.push(nextStroke);
  registerStrokeOrigin(timeline, nextStroke);
  addStrokeTimingSample(
    timeline,
    frameIndex * timeline.sampleStepBeats,
    nextStroke,
  );
  addGeometrySampleStroke(
    timeline,
    nextStroke.polyline.originId,
    frameIndex * timeline.sampleStepBeats,
    nextStroke,
  );
  timeline.nextWriteId = Math.max(timeline.nextWriteId, stroke.writeId + 1);
};

export const deleteOrigins = (
  timeline: GeometryTimeline | TimelineStageBuffer,
  originIds: Iterable<string>,
): void => {
  for (const originId of originIds) {
    timeline.originGroupIdByOriginId.delete(originId);
  }
};

export const deleteGeometrySamplesForOrigins = (
  timeline: GeometryTimeline | TimelineStageBuffer,
  originIds: Iterable<string>,
): void => {
  for (const originId of originIds) {
    timeline.geometrySamplesByOriginId.delete(originId);
  }
};

export const deleteTimingSamplesForOrigins = (
  timeline: GeometryTimeline | TimelineStageBuffer,
  originIds: Iterable<string>,
): void => {
  for (const originId of originIds) {
    timeline.timingSamplesByOriginId.delete(originId);
  }
};

export const completeTimelineStage = (
  timeline: GeometryTimeline | TimelineStageBuffer,
): GeometryTimeline => ({
  sampleStepBeats: timeline.sampleStepBeats,
  timeDomainEndBeat: timeline.timeDomainEndBeat,
  frames: timeline.frames.slice(),
  originGroupIdByOriginId: new Map(timeline.originGroupIdByOriginId),
  geometrySamplesByOriginId: cloneGeometrySamplesByOriginId(timeline.geometrySamplesByOriginId),
  timingSamplesByOriginId: cloneTimingSamplesByOriginId(timeline.timingSamplesByOriginId),
  nextWriteId: timeline.nextWriteId,
});

export const finalizeTimeline = (
  timeline: GeometryTimeline,
): GeometryTimeline => {
  const endBeat = Math.max(timeline.timeDomainEndBeat, 1);
  const frameCount = toFrameCount(endBeat, timeline.sampleStepBeats);

  if (frameCount === timeline.frames.length) {
    return timeline;
  }

  return {
    sampleStepBeats: timeline.sampleStepBeats,
    timeDomainEndBeat: endBeat,
    frames: timeline.frames.length > frameCount
      ? timeline.frames.slice(0, frameCount)
      : [
          ...timeline.frames,
          ...createEmptyFrames(frameCount - timeline.frames.length),
    ],
    originGroupIdByOriginId: new Map(timeline.originGroupIdByOriginId),
    geometrySamplesByOriginId: cloneGeometrySamplesByOriginId(timeline.geometrySamplesByOriginId),
    timingSamplesByOriginId: cloneTimingSamplesByOriginId(timeline.timingSamplesByOriginId),
    nextWriteId: timeline.nextWriteId,
  };
};

export const createIdentityMask = (
  contains: GeometryMask['contains'],
): GeometryMask => ({
  contains,
  inverseTransform: { ...IDENTITY_AFFINE },
});
