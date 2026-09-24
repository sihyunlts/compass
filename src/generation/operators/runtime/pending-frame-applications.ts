import {
  type PendingFrameApplication,
  type PendingGeometryRewriteApplication,
  type GenerationState,
  type PendingStrokeRewriteWrite,
} from '../../timeline/state';
import {
  addStrokeToFrameRange,
  addExistingStrokeToFrameRange,
  iterateTimelineFrames,
  beginTimelineStage,
  removeOriginStrokes,
} from '../../timeline';
import type { CanonicalOutputAdapter } from '../../types';
import type { TimelineWindow } from '../../timeline/temporal-window';
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
  writes: ReadonlyArray<PendingStrokeRewriteWrite>,
  options: {
    timelineStateOverrides?: ReadonlyMap<string, OriginTimelineStateOverride>;
    rescalePlaybackExtentOnVisibilityLoss?: boolean;
  } = {},
): GenerationState => {
  return appendPendingFrameApplication(
    state,
    {
      kind: 'stroke-rewrite',
      targetOriginIds: new Set(targetOriginIds),
      sourceFrameCount: sourceTimeline.frameCount,
      endBeat: sourceTimeline.timeDomainEndBeat,
      writes,
      rescalePlaybackExtentOnVisibilityLoss:
        options.rescalePlaybackExtentOnVisibilityLoss ?? false,
    },
    options.timelineStateOverrides,
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
    for (const stroke of write.strokes) {
      addStrokeToFrameRange(nextTimeline, write.startFrame, write.endFrameExclusive, stroke);
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
  const adjustedPlaybackExtentByOriginId = new Map<string, TimelineWindow>();
  let applicationIndex = 0;
  while (applicationIndex < state.pendingFrameApplications.length) {
    const application = state.pendingFrameApplications[applicationIndex];
    if (application.kind === 'stroke-rewrite') {
      const fixedTargetOriginIds = application.rescalePlaybackExtentOnVisibilityLoss
        ? Array.from(application.targetOriginIds).filter(
          (originId) => state.timelineStateByOriginId.get(originId)?.timelineDomain === 'fixed',
        )
        : [];
      const beforeVisibility = fixedTargetOriginIds.length > 0
        ? outputAdapter.buildVisibleWindowByOriginId(timeline, mutedGroupIds, mutedGeneratorIds)
        : null;
      timeline = materializePendingStrokeRewriteApplication(timeline, application);
      if (beforeVisibility) {
        const afterVisibility = outputAdapter.buildVisibleWindowByOriginId(
          timeline,
          mutedGroupIds,
          mutedGeneratorIds,
        );
        for (const originId of fixedTargetOriginIds) {
          const before = beforeVisibility.get(originId);
          const after = afterVisibility.get(originId);
          if (!before) continue;
          const playbackExtent = adjustedPlaybackExtentByOriginId.get(originId)
            ?? state.timelineStateByOriginId.get(originId)!.playbackExtent;
          if (!after) {
            adjustedPlaybackExtentByOriginId.set(originId, { start: 0, end: 0 });
          } else if (after.start > before.start || after.end < before.end) {
            // Preserve the proportion of empty time authored before this mask.
            const visibleScale = (after.end - after.start) / (before.end - before.start);
            adjustedPlaybackExtentByOriginId.set(originId, {
              start: after.start + (playbackExtent.start - before.start) * visibleScale,
              end: after.end + (playbackExtent.end - before.end) * visibleScale,
            });
          }
        }
      }
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

  const timelineStateByOriginId = buildTimelineStateByOriginId(
    timeline,
    state.timelineStateByOriginId,
    outputAdapter,
    mutedGroupIds,
    mutedGeneratorIds,
  );
  for (const [originId, playbackExtent] of adjustedPlaybackExtentByOriginId) {
    const timelineState = timelineStateByOriginId.get(originId);
    if (timelineState) {
      timelineStateByOriginId.set(originId, {
        ...timelineState,
        playbackExtent,
      });
    }
  }

  return transitionGenerationState(state, {
    timeline,
    timelineStateByOriginId,
    pendingFrameApplications: [],
  });
};
