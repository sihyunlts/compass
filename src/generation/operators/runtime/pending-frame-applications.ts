import {
  type PendingFrameApplication,
  type PendingGeometryRewriteApplication,
  type GenerationState,
  type PendingStrokeRewriteFrameWrite,
} from '../../timeline/state';
import {
  addStrokeToFrame,
  addExistingStrokeToFrameRange,
  iterateTimelineFrames,
  beginTimelineStage,
  removeOriginStrokes,
  type FrameWindow,
} from '../../timeline';
import type { CanonicalOutputAdapter } from '../../types';
import {
  applyTimelineStateOverrides,
  buildTimelineStateByOriginId,
  type OriginTimelineStateOverride,
} from './timeline-state';
import type { GeometryStroke, GeometryTimeline } from '../../types';
import { transitionGenerationState } from './state-transition';

const appendPendingFrameApplication = (
  state: GenerationState,
  application: PendingFrameApplication,
  timelineStateOverrides?: ReadonlyMap<string, OriginTimelineStateOverride>,
): GenerationState => {
  return transitionGenerationState(state, {
    pendingFrameApplications: application.targetOriginIds.size > 0
      ? [...state.pendingFrameApplications, application]
      : state.pendingFrameApplications,
    timelineStateByOriginId: timelineStateOverrides
      ? applyTimelineStateOverrides(state.timelineStateByOriginId, timelineStateOverrides)
      : state.timelineStateByOriginId,
  });
};

export const appendPendingStrokeRewriteApplication = (
  state: GenerationState,
  sourceTimeline: GeometryTimeline,
  targetOriginIds: ReadonlySet<string>,
  writes: ReadonlyArray<PendingStrokeRewriteFrameWrite>,
  timelineStateOverrides?: ReadonlyMap<string, OriginTimelineStateOverride>,
): GenerationState => {
  return appendPendingFrameApplication(
    state,
    {
      kind: 'stroke-rewrite',
      targetOriginIds: new Set(targetOriginIds),
      sourceFrameCount: sourceTimeline.frameCount,
      endBeat: sourceTimeline.timeDomainEndBeat,
      writes,
    },
    timelineStateOverrides,
  );
};

export const appendPendingGeometryRewriteApplication = (
  state: GenerationState,
  targetOriginIds: ReadonlySet<string>,
  rewriteFrameStrokes: PendingGeometryRewriteApplication['rewriteFrameStrokes'],
  timelineStateOverrides?: ReadonlyMap<string, OriginTimelineStateOverride>,
): GenerationState => {
  return appendPendingFrameApplication(
    state,
    {
      kind: 'geometry-rewrite',
      targetOriginIds: new Set(targetOriginIds),
      rewriteFrameStrokes,
    },
    timelineStateOverrides,
  );
};

export const buildPendingStrokeRewriteFrameWrites = (
  timeline: GeometryTimeline,
  targetOriginIds: ReadonlySet<string>,
  frameWindow: FrameWindow,
  rewriteFrameStrokes: (
    frameIndex: number,
    strokes: ReadonlyArray<GeometryStroke>,
  ) => ReadonlyArray<Omit<GeometryStroke, 'writeId'>>,
): PendingStrokeRewriteFrameWrite[] => {
  const writes: PendingStrokeRewriteFrameWrite[] = [];
  const originIds = Array.from(targetOriginIds);
  for (const { frameIndex, strokes: frameStrokes } of iterateTimelineFrames(timeline, frameWindow, targetOriginIds)) {
    const byOrigin = new Map<string, GeometryStroke[]>();
    for (const stroke of frameStrokes) {
      const originId = stroke.polyline.originId;
      const strokes = byOrigin.get(originId);
      if (strokes) strokes.push(stroke);
      else byOrigin.set(originId, [stroke]);
    }
    const sourceStrokes = originIds.flatMap((originId) => byOrigin.get(originId) ?? []);
    if (sourceStrokes.length === 0) {
      continue;
    }

    const strokes = rewriteFrameStrokes(frameIndex, sourceStrokes);
    if (strokes.length === 0) {
      continue;
    }

    writes.push({
      destinationFrameIndex: frameIndex,
      strokes,
    });
  }

  return writes;
};

const materializePendingStrokeRewriteApplication = (
  timeline: GeometryTimeline,
  application: Extract<PendingFrameApplication, { kind: 'stroke-rewrite' }>,
): GeometryTimeline => {
  const nextTimeline = beginTimelineStage(timeline, Math.max(timeline.timeDomainEndBeat, application.endBeat));
  removeOriginStrokes(
    nextTimeline,
    application.targetOriginIds,
    Math.min(application.sourceFrameCount, nextTimeline.frameCount),
  );
  for (const write of application.writes) {
    if (write.destinationFrameIndex < 0 || write.destinationFrameIndex >= nextTimeline.frameCount) {
      continue;
    }
    for (const stroke of write.strokes) {
      addStrokeToFrame(nextTimeline, write.destinationFrameIndex, stroke);
    }
  }
  return nextTimeline;
};

interface FrameRewriteStroke {
  stroke: GeometryStroke;
  applicationIndex: number;
}

const materializeGeometryRewriteBatch = (
  timeline: GeometryTimeline,
  applications: ReadonlyArray<PendingGeometryRewriteApplication>,
): GeometryTimeline => {
  const targetOriginIds = new Set(
    applications.flatMap((application) => Array.from(application.targetOriginIds)),
  );
  const nextTimeline = beginTimelineStage(timeline);
  removeOriginStrokes(nextTimeline, targetOriginIds, timeline.frameCount);
  const writesByApplication = applications.map(
    () => [] as Array<{ frameIndex: number; stroke: GeometryStroke }>,
  );
  const writeCounts = applications.map(() => 0);

  for (const { frameIndex, strokes } of iterateTimelineFrames(timeline, undefined, targetOriginIds)) {
    const currentByOrigin = new Map<string, FrameRewriteStroke[]>();
    const append = (entry: FrameRewriteStroke): void => {
      const originId = entry.stroke.polyline.originId;
      const entries = currentByOrigin.get(originId);
      if (entries) entries.push(entry);
      else currentByOrigin.set(originId, [entry]);
    };
    // Every input origin is targeted by this batch, so every surviving input
    // receives an application index before it is written to the output.
    for (const stroke of strokes) append({ stroke, applicationIndex: -1 });

    for (let applicationIndex = 0; applicationIndex < applications.length; applicationIndex += 1) {
      const application = applications[applicationIndex];
      const sourceStrokes: GeometryStroke[] = [];
      for (const originId of application.targetOriginIds) {
        for (const entry of currentByOrigin.get(originId) ?? []) sourceStrokes.push(entry.stroke);
        currentByOrigin.delete(originId);
      }
      if (sourceStrokes.length === 0) continue;
      const rewritten = application.rewriteFrameStrokes({
        sampleStepBeats: timeline.sampleStepBeats,
        frameIndex,
        strokes: sourceStrokes,
      });
      for (const stroke of rewritten) {
        append({
          stroke: { ...stroke, writeId: writeCounts[applicationIndex]++ },
          applicationIndex,
        });
      }
    }
    for (const entries of currentByOrigin.values()) {
      for (const entry of entries) {
        writesByApplication[entry.applicationIndex].push({ frameIndex, stroke: entry.stroke });
      }
    }
  }

  // Reserve ids in stage order, including writes overwritten by later stages.
  // Frame-local execution must not change the original overlap precedence.
  let firstWriteId = timeline.nextWriteId;
  for (let applicationIndex = 0; applicationIndex < applications.length; applicationIndex += 1) {
    const writes = writesByApplication[applicationIndex]
      .sort((left, right) => left.stroke.writeId - right.stroke.writeId);
    for (const { frameIndex, stroke } of writes) {
      addExistingStrokeToFrameRange(nextTimeline, frameIndex, frameIndex + 1, {
        ...stroke,
        writeId: firstWriteId + stroke.writeId,
      });
    }
    firstWriteId += writeCounts[applicationIndex];
  }
  nextTimeline.nextWriteId = firstWriteId;
  return nextTimeline;
};

export const materializePendingFrameApplications = (
  state: GenerationState,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): GenerationState => {
  if (state.pendingFrameApplications.length === 0) {
    return state;
  }

  let timeline = state.timeline;
  let applicationIndex = 0;
  while (applicationIndex < state.pendingFrameApplications.length) {
    const application = state.pendingFrameApplications[applicationIndex];
    if (application.kind === 'stroke-rewrite') {
      timeline = materializePendingStrokeRewriteApplication(timeline, application);
      applicationIndex += 1;
      continue;
    }
    const batch: PendingGeometryRewriteApplication[] = [];
    while (applicationIndex < state.pendingFrameApplications.length) {
      const next = state.pendingFrameApplications[applicationIndex];
      if (next.kind !== 'geometry-rewrite') break;
      batch.push(next);
      applicationIndex += 1;
    }
    timeline = materializeGeometryRewriteBatch(timeline, batch);
  }

  return transitionGenerationState(state, {
    timeline,
    timelineStateByOriginId: buildTimelineStateByOriginId(
      timeline,
      state.timelineStateByOriginId,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    ),
    pendingFrameApplications: [],
  });
};
