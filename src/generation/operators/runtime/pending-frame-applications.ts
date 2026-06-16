import {
  clonePendingFrameApplications,
  type PendingColorApplication,
  type PendingFrameApplication,
  type PendingGeometryRewriteApplication,
  type MutableGenerationState,
  type PendingStrokeRewriteApplication,
  type PendingStrokeRewriteFrameWrite,
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
import type { PendingFrameApplicationOperatorInput } from './types';
import { resolveFrameWindow } from './frame-window';
import {
  applyFinalCleanupModeUpdate,
  transitionGenerationState,
  type FinalCleanupModeUpdate,
  type GenerationStateTransitionOverrides,
} from './state-transition';

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

type PendingFrameApplicationDraft =
  | Omit<PendingColorApplication, 'precedingTemporalCheckpoint'>
  | Omit<PendingGeometryRewriteApplication, 'precedingTemporalCheckpoint'>
  | Omit<PendingStrokeRewriteApplication, 'precedingTemporalCheckpoint'>;

type PendingFrameApplicationAppendInput = Pick<
  PendingFrameApplicationOperatorInput,
  'baseState' | 'precedingTemporalCheckpoint'
>;

const attachTemporalCheckpoint = (
  input: PendingFrameApplicationAppendInput,
  application: PendingFrameApplicationDraft,
): PendingFrameApplication => ({
  ...application,
  precedingTemporalCheckpoint: input.precedingTemporalCheckpoint,
});

export const appendPendingFrameApplication = (
  input: PendingFrameApplicationAppendInput,
  application: PendingFrameApplicationDraft,
  options: {
    timelineStateByOriginId?: MutableGenerationState['timelineStateByOriginId'];
    finalCleanupModeUpdate?: FinalCleanupModeUpdate;
  } = {},
): MutableGenerationState => {
  const state = input.baseState;
  const pendingFrameApplications = clonePendingFrameApplications(state.pendingFrameApplications);
  if (application.targetOriginIds.size > 0) {
    pendingFrameApplications.push(attachTemporalCheckpoint(input, application));
  }

  const timelineStateByOriginId = options.finalCleanupModeUpdate
    ? applyFinalCleanupModeUpdate(
        options.timelineStateByOriginId ?? state.timelineStateByOriginId,
        options.finalCleanupModeUpdate,
      )
    : options.timelineStateByOriginId;
  const overrides: GenerationStateTransitionOverrides = {
    pendingFrameApplications,
  };
  if (timelineStateByOriginId) {
    overrides.timelineStateByOriginId = timelineStateByOriginId;
  }

  return transitionGenerationState(state, overrides);
};

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
  input: PendingFrameApplicationOperatorInput,
  targetOriginIds: ReadonlySet<string>,
  writes: ReadonlyArray<PendingStrokeRewriteFrameWrite>,
  finalCleanupModeUpdate: FinalCleanupModeUpdate,
): MutableGenerationState => {
  return appendPendingFrameApplication(
    input,
    {
      kind: 'stroke-rewrite',
      targetOriginIds: new Set(targetOriginIds),
      sourceFrameCount: input.sourceState.timeline.frames.length,
      endBeat: input.sourceState.timeline.timeDomainEndBeat,
      writes,
    },
    { finalCleanupModeUpdate },
  );
};

export const appendPendingGeometryRewriteApplication = (
  input: PendingFrameApplicationAppendInput,
  targetOriginIds: ReadonlySet<string>,
  requiredFrameWindow: PendingGeometryRewriteApplication['requiredFrameWindow'],
  rewriteFrameStrokes: PendingGeometryRewriteApplication['rewriteFrameStrokes'],
  finalCleanupModeUpdate: FinalCleanupModeUpdate,
): MutableGenerationState => {
  return appendPendingFrameApplication(
    input,
    {
      kind: 'geometry-rewrite',
      targetOriginIds: new Set(targetOriginIds),
      requiredFrameWindow,
      rewriteFrameStrokes,
    },
    { finalCleanupModeUpdate },
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

type PendingFrameApplicationStage = ReturnType<typeof beginTimelineStage>;
interface PendingFrameApplicationStageInput {
  targetOriginIds: ReadonlySet<string>;
  sourceFrameCount: number;
  endBeat: number;
}

const isFrameIndexWithinTimeline = (
  timeline: GeometryTimeline,
  frameIndex: number,
): boolean => frameIndex >= 0 && frameIndex < timeline.frames.length;

const filterFrameIndexesWithinTimeline = (
  timeline: GeometryTimeline,
  frameIndexes: ReadonlyArray<number>,
): number[] => frameIndexes.filter((frameIndex) => isFrameIndexWithinTimeline(timeline, frameIndex));

const materializePendingFrameApplicationStage = (
  timeline: GeometryTimeline,
  application: PendingFrameApplicationStageInput,
  applyWrites: (timeline: PendingFrameApplicationStage) => void,
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

  applyWrites(nextTimeline);

  return completeTimelineStage(nextTimeline);
};

const materializePendingStrokeRewriteApplication = (
  timeline: GeometryTimeline,
  application: Extract<PendingFrameApplication, { kind: 'stroke-rewrite' }>,
): GeometryTimeline => materializePendingFrameApplicationStage(timeline, application, (nextTimeline) => {
  for (const write of application.writes) {
    if (!isFrameIndexWithinTimeline(nextTimeline, write.destinationFrameIndex)) {
      continue;
    }

    for (const stroke of write.strokes) {
      addStrokeToFrame(nextTimeline, write.destinationFrameIndex, stroke);
    }
  }
});

const materializePendingGeometryRewriteApplication = (
  timeline: GeometryTimeline,
  application: Extract<PendingFrameApplication, { kind: 'geometry-rewrite' }>,
): GeometryTimeline => {
  const sourceStrokesByOriginAndFrame = buildSourceStrokesByOriginAndFrame(
    timeline,
    application.targetOriginIds,
  );
  const frameWindow = resolveFrameWindow(
    application.requiredFrameWindow,
    timeline.sampleStepBeats,
    timeline.frames.length,
  );

  return materializePendingFrameApplicationStage(
    timeline,
    {
      targetOriginIds: application.targetOriginIds,
      sourceFrameCount: timeline.frames.length,
      endBeat: timeline.timeDomainEndBeat,
    },
    (nextTimeline) => {
      for (
        let frameIndex = frameWindow.startFrame;
        frameIndex < frameWindow.endFrameExclusive;
        frameIndex += 1
      ) {
        const sourceStrokes = Array.from(application.targetOriginIds).flatMap((originId) => (
          sourceStrokesByOriginAndFrame.get(originId)?.get(frameIndex) ?? []
        ));
        if (sourceStrokes.length === 0) {
          continue;
        }

        const rewrittenStrokes = application.rewriteFrameStrokes({
          timeline,
          frameIndex,
          strokes: sourceStrokes,
        });
        for (const stroke of rewrittenStrokes) {
          addStrokeToFrame(nextTimeline, frameIndex, stroke);
        }
      }
    },
  );
};

const materializePendingColorApplication = (
  timeline: GeometryTimeline,
  application: Extract<PendingFrameApplication, { kind: 'color' }>,
): GeometryTimeline => materializePendingFrameApplicationStage(timeline, application, (nextTimeline) => {
  for (const write of application.writes) {
    const destinationFrameIndexes = filterFrameIndexesWithinTimeline(
      nextTimeline,
      write.destinationFrameIndexes,
    );
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
});

const materializePendingFrameApplication = (
  timeline: GeometryTimeline,
  application: PendingFrameApplication,
): GeometryTimeline => {
  const sourceTimeline = application.precedingTemporalCheckpoint
    ? materializeTemporalCheckpointTimeline(
        timeline,
        application.precedingTemporalCheckpoint,
      )
    : timeline;

  if (application.kind === 'geometry-rewrite') {
    return materializePendingGeometryRewriteApplication(sourceTimeline, application);
  }

  if (application.kind === 'stroke-rewrite') {
    return materializePendingStrokeRewriteApplication(sourceTimeline, application);
  }

  return materializePendingColorApplication(sourceTimeline, application);
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
    timeline = materializePendingFrameApplication(timeline, application);
  }

  return transitionGenerationState(state, {
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
    pendingFrameApplications: [],
  });
};
