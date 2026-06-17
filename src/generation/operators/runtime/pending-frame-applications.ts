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
  buildSourceStrokesByOriginAndFrame,
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
import {
  buildPendingColorMaterialization,
  sampleColorProgramSlotsIntoStage,
} from './color-materialization';

const mergePlaybackWindowOverrides = (
  playbackWindowOverrideMaps: ReadonlyArray<ReadonlyMap<string, TimelineWindow>>,
): Map<string, TimelineWindow> => {
  const overrides = new Map<string, TimelineWindow>();

  for (const playbackWindowOverrideMap of playbackWindowOverrideMaps) {
    for (const [originId, playbackWindow] of playbackWindowOverrideMap.entries()) {
      overrides.set(
        originId,
        mergeTimelineWindows(overrides.get(originId), playbackWindow),
      );
    }
  }

  return overrides;
};

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

const appendPendingFrameApplication = (
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

export const appendPendingColorApplication = (
  input: PendingFrameApplicationAppendInput,
  application: Omit<PendingColorApplication, 'kind' | 'precedingTemporalCheckpoint'>,
  options: {
    timelineStateByOriginId?: MutableGenerationState['timelineStateByOriginId'];
    finalCleanupModeUpdate: FinalCleanupModeUpdate;
  },
): MutableGenerationState => appendPendingFrameApplication(
  input,
  {
    kind: 'color',
    ...application,
  },
  options,
);

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

type PendingFrameRewriteStage = ReturnType<typeof beginTimelineStage>;

type PendingFrameRewriteApplication = Extract<
  PendingFrameApplication,
  { kind: 'geometry-rewrite' | 'stroke-rewrite' }
>;

interface PendingFrameRewritePlan {
  targetOriginIds: ReadonlySet<string>;
  sourceFrameCount: number;
  endBeat: number;
}

const isFrameIndexWithinTimeline = (
  timeline: GeometryTimeline,
  frameIndex: number,
): boolean => frameIndex >= 0 && frameIndex < timeline.frames.length;

const materializeTargetOriginFrameRewrite = (
  timeline: GeometryTimeline,
  plan: PendingFrameRewritePlan,
  applyWrites: (timeline: PendingFrameRewriteStage) => void,
): GeometryTimeline => {
  const nextTimeline = beginTimelineStage(
    timeline,
    Math.max(timeline.timeDomainEndBeat, plan.endBeat),
  );
  stripOriginFrames(
    nextTimeline,
    Math.min(plan.sourceFrameCount, nextTimeline.frames.length),
    plan.targetOriginIds,
  );

  applyWrites(nextTimeline);

  return completeTimelineStage(nextTimeline);
};

const materializePendingStrokeRewriteApplication = (
  timeline: GeometryTimeline,
  application: Extract<PendingFrameApplication, { kind: 'stroke-rewrite' }>,
): GeometryTimeline => materializeTargetOriginFrameRewrite(timeline, application, (nextTimeline) => {
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

  return materializeTargetOriginFrameRewrite(
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

interface PendingFrameApplicationMaterializationResult {
  timeline: GeometryTimeline;
  playbackWindowByOriginId?: ReadonlyMap<string, TimelineWindow>;
}

const materializePendingColorApplication = (
  timeline: GeometryTimeline,
  application: Extract<PendingFrameApplication, { kind: 'color' }>,
): PendingFrameApplicationMaterializationResult => {
  const colorMaterialization = buildPendingColorMaterialization(
    timeline,
    application,
    application.precedingTemporalCheckpoint,
  );
  const nextTimeline = materializeTargetOriginFrameRewrite(
    timeline,
    {
      targetOriginIds: application.targetOriginIds,
      sourceFrameCount: timeline.frames.length,
      endBeat: colorMaterialization.plan.colorTimelineEndBeat,
    },
    (timelineStage) => {
      sampleColorProgramSlotsIntoStage(
        timelineStage,
        timeline.sampleStepBeats,
        application,
        colorMaterialization.plan,
        colorMaterialization.geometry,
        colorMaterialization.frameWindow,
        colorMaterialization.outputFrameCount,
      );
    },
  );

  return {
    timeline: nextTimeline,
    playbackWindowByOriginId: colorMaterialization.plan.playbackWindowByOriginId,
  };
};

const resolveFrameRewriteSourceTimeline = (
  timeline: GeometryTimeline,
  application: PendingFrameRewriteApplication,
): GeometryTimeline => (
  application.precedingTemporalCheckpoint
    ? materializeTemporalCheckpointTimeline(
        timeline,
        application.precedingTemporalCheckpoint,
      )
    : timeline
);

const materializePendingFrameApplication = (
  timeline: GeometryTimeline,
  application: PendingFrameApplication,
): PendingFrameApplicationMaterializationResult => {
  switch (application.kind) {
    case 'color':
      return materializePendingColorApplication(timeline, application);
    case 'geometry-rewrite': {
      const sourceTimeline = resolveFrameRewriteSourceTimeline(timeline, application);
      return {
        timeline: materializePendingGeometryRewriteApplication(sourceTimeline, application),
      };
    }
    case 'stroke-rewrite': {
      const sourceTimeline = resolveFrameRewriteSourceTimeline(timeline, application);
      return {
        timeline: materializePendingStrokeRewriteApplication(sourceTimeline, application),
      };
    }
  }
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
  const playbackWindowOverrideMaps: ReadonlyMap<string, TimelineWindow>[] = [];
  for (const application of state.pendingFrameApplications) {
    const materialization = materializePendingFrameApplication(timeline, application);
    timeline = materialization.timeline;
    if (materialization.playbackWindowByOriginId) {
      playbackWindowOverrideMaps.push(materialization.playbackWindowByOriginId);
    }
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
      mergePlaybackWindowOverrides(playbackWindowOverrideMaps),
    ),
    pendingFrameApplications: [],
  });
};
