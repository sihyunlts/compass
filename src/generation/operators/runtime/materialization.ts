import type { SceneTemporalState } from '../../../core/core-types';
import {
  createIdentitySceneTemporalState,
} from '../../../core/scene-operators/temporal';
import {
  clonePendingFrameApplications,
  clonePendingTemporalWriteOrderByOriginId,
  type MutableGenerationState,
  type OriginTimelineState,
  type PendingTemporalMaterializationCheckpoint,
} from '../../timeline/state';
import {
  clampSceneTemporalStateToFixedLoop,
  FIXED_TIMELINE_END_BEAT,
  isFixedTimelineWindow,
  isWindowEmpty,
  TIMELINE_WINDOW_EPSILON,
} from '../../timeline/temporal-window';
import {
  beginTimelineStage,
  completeTimelineStage,
  toFrameCount,
} from '../../timeline';
import type {
  CanonicalOutputAdapter,
  GeometryTimeline,
} from '../../types';
import {
  toSourceFrameIndex,
} from './timeline-strokes';
import {
  buildTimelineStateByOriginId,
} from './timeline-state';
import type {
  OriginFrameRemap,
  RackOperatorInputPreparation,
  RackStageExecutionContext,
} from './types';
import { materializePendingFrameApplications } from './pending-frame-applications';
import {
  extractPendingTemporalCheckpoint,
  materializePendingTemporalState,
} from './pending-temporal';
import { remapTimeline } from './frame-remap';

const hasMappedSourceFrame = (
  sourceFrameIndexByOutputFrame: ReadonlyArray<number | null>,
): boolean => sourceFrameIndexByOutputFrame.some((frameIndex) => frameIndex !== null);

const buildFrontBackPaddingCleanupRemaps = (
  state: MutableGenerationState,
): Map<string, OriginFrameRemap> => {
  const remaps = new Map<string, OriginFrameRemap>();
  const outputFrameCount = toFrameCount(FIXED_TIMELINE_END_BEAT, state.timeline.sampleStepBeats);

  for (const [originId, timelineState] of state.timelineStateByOriginId.entries()) {
    if (
      timelineState.temporal.hasAuthoredTimeline
      || state.sealedOriginIds.has(originId)
      || isWindowEmpty(timelineState.playbackWindow)
    ) {
      continue;
    }

    if (
      state.timeline.timeDomainEndBeat <= FIXED_TIMELINE_END_BEAT + TIMELINE_WINDOW_EPSILON
      && isFixedTimelineWindow(timelineState.playbackWindow)
    ) {
      continue;
    }

    const sourceWindow = timelineState.playbackWindow;
    const sourceSpan = sourceWindow.end - sourceWindow.start;
    if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
      continue;
    }

    const sourceFrameIndexByOutputFrame: Array<number | null> = Array.from(
      { length: outputFrameCount },
      (_, frameIndex) => {
        const outputBeat = frameIndex * state.timeline.sampleStepBeats;
        const normalized = outputBeat / FIXED_TIMELINE_END_BEAT;
        return toSourceFrameIndex(
          sourceWindow.start + sourceSpan * normalized,
          state.timeline,
        );
      },
    );
    if (!hasMappedSourceFrame(sourceFrameIndexByOutputFrame)) {
      continue;
    }

    remaps.set(originId, {
      nextTemporal: createIdentitySceneTemporalState(),
      sourceFrameIndexByOutputFrame,
      writeOrder: 0,
    });
  }

  return remaps;
};

const buildInvariantTemporalOverrides = (
  timelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
): Map<string, SceneTemporalState> => {
  const overrides = new Map<string, SceneTemporalState>();

  for (const [originId, timelineState] of timelineStateByOriginId.entries()) {
    overrides.set(originId, clampSceneTemporalStateToFixedLoop(timelineState.temporal));
  }

  return overrides;
};

const clampTimelineToFixedLoop = (
  timeline: GeometryTimeline,
): GeometryTimeline => (
  timeline.timeDomainEndBeat <= FIXED_TIMELINE_END_BEAT + TIMELINE_WINDOW_EPSILON
    && timeline.frames.length === toFrameCount(FIXED_TIMELINE_END_BEAT, timeline.sampleStepBeats)
)
  ? timeline
  : completeTimelineStage(beginTimelineStage(timeline, FIXED_TIMELINE_END_BEAT));

const sealStageWithTemporalInvariant = (
  state: MutableGenerationState,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const temporalOverrides = buildInvariantTemporalOverrides(state.timelineStateByOriginId);
  const cleanupRemaps = buildFrontBackPaddingCleanupRemaps(state);
  const nextTimeline = cleanupRemaps.size > 0
    ? remapTimeline(
        state.timeline,
        cleanupRemaps,
        'all',
        FIXED_TIMELINE_END_BEAT,
        true,
      )
    : clampTimelineToFixedLoop(state.timeline);

  const timelineStateByOriginId = buildTimelineStateByOriginId(
    nextTimeline,
    state.timelineStateByOriginId,
    outputAdapter,
    mutedGroupIds,
    mutedGeneratorIds,
    cleanupRemaps.size > 0
      ? new Map([
          ...temporalOverrides,
          ...Array.from(
            cleanupRemaps.entries(),
            ([originId, remap]) => [originId, remap.nextTemporal] as const,
          ),
        ])
      : temporalOverrides,
  );

  return {
    timeline: nextTimeline,
    timelineStateByOriginId,
    pendingTemporalWriteOrderByOriginId: cleanupRemaps.size > 0
      ? new Map<string, number>()
      : clonePendingTemporalWriteOrderByOriginId(state.pendingTemporalWriteOrderByOriginId),
    pendingFrameApplications: clonePendingFrameApplications(state.pendingFrameApplications),
    sealedOriginIds: new Set(timelineStateByOriginId.keys()),
  };
};

export const materializePendingRackOperatorInput: RackOperatorInputPreparation = (
  state: MutableGenerationState,
  context: RackStageExecutionContext,
): MutableGenerationState => {
  const frameMaterializedState = materializePendingFrameApplications(
    state,
    context.outputAdapter,
    context.mutedGroupIds,
    context.mutedGeneratorIds,
  );

  return materializePendingTemporalState(
    frameMaterializedState,
    context.outputAdapter,
    context.mutedGroupIds,
    context.mutedGeneratorIds,
  );
};

export const preparePendingFrameApplicationInput = (
  state: MutableGenerationState,
  context: RackStageExecutionContext,
): {
  baseState: MutableGenerationState;
  sourceState: MutableGenerationState;
  precedingTemporalCheckpoint: PendingTemporalMaterializationCheckpoint | null;
} => {
  const pendingTemporalExtraction = extractPendingTemporalCheckpoint(state);
  const baseState = pendingTemporalExtraction?.state ?? state;
  const sourceState = pendingTemporalExtraction || state.pendingFrameApplications.length > 0
    ? materializePendingRackOperatorInput(state, context)
    : state;

  return {
    baseState,
    sourceState,
    precedingTemporalCheckpoint: pendingTemporalExtraction?.checkpoint ?? null,
  };
};

const sealMaterializedRackState = (
  state: MutableGenerationState,
  context: RackStageExecutionContext,
): MutableGenerationState => sealStageWithTemporalInvariant(
  state,
  context.outputAdapter,
  context.mutedGroupIds,
  context.mutedGeneratorIds,
);

export const materializeAndSealRackState = (
  state: MutableGenerationState,
  context: RackStageExecutionContext,
): MutableGenerationState => sealMaterializedRackState(
  materializePendingRackOperatorInput(state, context),
  context,
);

export const preservePendingRackOperatorInput: RackOperatorInputPreparation = (
  state: MutableGenerationState,
): MutableGenerationState => state;
