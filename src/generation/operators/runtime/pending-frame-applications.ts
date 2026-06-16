import {
  clonePendingTemporalWriteOrderByOriginId,
  clonePendingFrameApplications,
  cloneSealedOriginIds,
  type PendingFrameApplication,
  type MutableGenerationState,
  type PendingStrokeRewriteFrameWrite,
  type PendingTemporalMaterializationCheckpoint,
} from '../../timeline/state';
import {
  addStrokeToFrame,
  addStrokeToFrames,
  beginTimelineStage,
  completeTimelineStage,
  type FrameWindow,
} from '../../timeline';
import {
  mergeTimelineWindows,
  type TimelineWindow,
} from '../../timeline/temporal-window';
import type { CanonicalOutputAdapter } from '../../types';
import {
  buildTargetOriginIds,
  buildSourceStrokesByOriginAndFrame,
  cloneStrokeWithVelocityAndWriteOrder,
  stripOriginFrames,
} from './timeline-strokes';
import { buildTimelineStateByOriginId } from './timeline-state';
import type { GeometryStroke, GeometryTimeline } from '../../types';
import { materializeTemporalCheckpointTimeline } from './pending-temporal';

const mergePlaybackWindowOverrides = (
  applications: ReadonlyArray<MutableGenerationState['pendingFrameApplications'][number]>,
): Map<string, TimelineWindow> => {
  const overrides = new Map<string, TimelineWindow>();

  for (const application of applications) {
    if (application.kind !== 'color') {
      continue;
    }

    for (const [originId, playbackWindow] of application.playbackWindowByOriginId.entries()) {
      overrides.set(
        originId,
        mergeTimelineWindows(overrides.get(originId), playbackWindow),
      );
    }
  }

  return overrides;
};

interface ColorSourceSnapshot {
  targetOriginIds: Set<string>;
  sourceStrokesByOriginAndFrame: Map<string, Map<number, GeometryStroke[]>>;
  frameCount: number;
  timeDomainEndBeat: number;
}

export const buildColorSourceSnapshot = (
  timeline: GeometryTimeline,
  targetGroupId: string | null,
  options: {
    excludeMutedSources: boolean;
    mutedGroupIds: ReadonlySet<string>;
    mutedGeneratorIds: ReadonlySet<string>;
  },
): ColorSourceSnapshot => {
  const targetOriginIds = buildTargetOriginIds(
    timeline,
    targetGroupId,
    options,
  );
  const sourceStrokesByOriginAndFrame = buildSourceStrokesByOriginAndFrame(
    timeline,
    targetOriginIds,
  );

  return {
    targetOriginIds,
    sourceStrokesByOriginAndFrame,
    frameCount: timeline.frames.length,
    timeDomainEndBeat: timeline.timeDomainEndBeat,
  };
};

export const appendPendingStrokeRewriteApplication = (
  state: MutableGenerationState,
  sourceState: MutableGenerationState,
  targetOriginIds: ReadonlySet<string>,
  writes: ReadonlyArray<PendingStrokeRewriteFrameWrite>,
  precedingTemporalCheckpoint: PendingTemporalMaterializationCheckpoint | null,
  sealedOriginIds: ReadonlySet<string>,
): MutableGenerationState => {
  const pendingFrameApplications = clonePendingFrameApplications(state.pendingFrameApplications);
  if (targetOriginIds.size > 0) {
    pendingFrameApplications.push({
      kind: 'stroke-rewrite',
      precedingTemporalCheckpoint,
      targetOriginIds: new Set(targetOriginIds),
      sourceFrameCount: sourceState.timeline.frames.length,
      endBeat: sourceState.timeline.timeDomainEndBeat,
      writes,
    });
  }

  return {
    timeline: state.timeline,
    timelineStateByOriginId: state.timelineStateByOriginId,
    pendingTemporalWriteOrderByOriginId: clonePendingTemporalWriteOrderByOriginId(
      state.pendingTemporalWriteOrderByOriginId,
    ),
    pendingFrameApplications,
    sealedOriginIds: cloneSealedOriginIds(sealedOriginIds),
  };
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
  const sourceStrokesByOriginAndFrame = buildSourceStrokesByOriginAndFrame(
    timeline,
    targetOriginIds,
  );
  const writes: PendingStrokeRewriteFrameWrite[] = [];

  for (
    let frameIndex = frameWindow.startFrame;
    frameIndex < frameWindow.endFrameExclusive;
    frameIndex += 1
  ) {
    const sourceStrokes = Array.from(targetOriginIds).flatMap((originId) => (
      sourceStrokesByOriginAndFrame.get(originId)?.get(frameIndex) ?? []
    ));
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
  const nextTimeline = beginTimelineStage(
    timeline,
    Math.max(timeline.timeDomainEndBeat, application.endBeat),
  );
  stripOriginFrames(
    nextTimeline,
    Math.min(application.sourceFrameCount, nextTimeline.frames.length),
    application.targetOriginIds,
  );

  for (const write of application.writes) {
    if (
      write.destinationFrameIndex < 0
      || write.destinationFrameIndex >= nextTimeline.frames.length
    ) {
      continue;
    }

    for (const stroke of write.strokes) {
      addStrokeToFrame(nextTimeline, write.destinationFrameIndex, stroke);
    }
  }

  return completeTimelineStage(nextTimeline);
};

export const materializePendingFrameApplications = (
  state: MutableGenerationState,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  if (state.pendingFrameApplications.length === 0) {
    return state;
  }

  let timeline = state.timeline;
  for (const application of state.pendingFrameApplications) {
    if (application.precedingTemporalCheckpoint) {
      timeline = materializeTemporalCheckpointTimeline(
        timeline,
        application.precedingTemporalCheckpoint,
      );
    }

    if (application.kind === 'stroke-rewrite') {
      timeline = materializePendingStrokeRewriteApplication(timeline, application);
      continue;
    }

    const nextTimeline = beginTimelineStage(
      timeline,
      Math.max(timeline.timeDomainEndBeat, application.endBeat),
    );
    stripOriginFrames(
      nextTimeline,
      Math.min(application.sourceFrameCount, nextTimeline.frames.length),
      application.targetOriginIds,
    );

    for (const write of application.writes) {
      const destinationFrameIndexes = write.destinationFrameIndexes.filter((frameIndex) => (
        frameIndex >= 0 && frameIndex < nextTimeline.frames.length
      ));
      if (destinationFrameIndexes.length === 0) {
        continue;
      }

      for (const stroke of write.sourceStrokes) {
        addStrokeToFrames(
          nextTimeline,
          destinationFrameIndexes,
          cloneStrokeWithVelocityAndWriteOrder(
            stroke,
            write.velocity,
            write.writeOrder,
            write.slotIndex,
            write.slotCount,
            write.colorSlotGapFill,
          ),
        );
      }
    }

    timeline = completeTimelineStage(nextTimeline);
  }

  return {
    timeline,
    timelineStateByOriginId: buildTimelineStateByOriginId(
      timeline,
      state.timelineStateByOriginId,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
      undefined,
      mergePlaybackWindowOverrides(state.pendingFrameApplications),
    ),
    pendingTemporalWriteOrderByOriginId: clonePendingTemporalWriteOrderByOriginId(
      state.pendingTemporalWriteOrderByOriginId,
    ),
    pendingFrameApplications: [],
    sealedOriginIds: cloneSealedOriginIds(state.sealedOriginIds),
  };
};
