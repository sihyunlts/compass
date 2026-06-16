import type { SceneTemporalState } from '../../../core/core-types';
import {
  cloneSceneTemporalState,
  createIdentitySceneTemporalState,
  evaluateTemporalRemap,
} from '../../../core/scene-operators/temporal';
import type { BeatRange } from '../../analysis/types';
import {
  clonePendingTemporalWriteOrderByOriginId,
  cloneSealedOriginIds,
  cloneTimelineStateByOriginId,
  type MutableGenerationState,
  type OriginTimelineState,
} from '../../timeline/state';
import {
  clampSceneTemporalStateToFixedLoop,
  cloneTimelineWindow,
  createMaterializedTemporalState,
  FIXED_TIMELINE_END_BEAT,
  hasPendingTemporalState,
  isFixedTimelineWindow,
  isWindowEmpty,
  resolveTemporalPlacementWindow,
  TIMELINE_WINDOW_EPSILON,
} from '../../timeline/temporal-window';
import {
  addExistingStrokeToFrame,
  beginTimelineStage,
  completeTimelineStage,
  toFrameCount,
} from '../../timeline';
import type {
  CanonicalOutputAdapter,
  GeometryTimeline,
} from '../../types';
import { isFrameWithinWindow, resolveFrameWindow } from './frame-window';
import {
  addRemappedStrokeToFrame,
  buildSourceStrokesByOriginAndFrame,
  stripOriginFrames,
  toSourceFrameIndex,
} from './timeline-strokes';
import {
  buildTimelineStateAfterTemporalMaterialization,
  buildTimelineStateByOriginId,
} from './timeline-state';
import type {
  OriginFrameRemap,
  RackOperatorInputPreparation,
  RackStageExecutionContext,
} from './types';

const hasMappedSourceFrame = (
  sourceFrameIndexByOutputFrame: ReadonlyArray<number | null>,
): boolean => sourceFrameIndexByOutputFrame.some((frameIndex) => frameIndex !== null);

const remapTimeline = (
  state: MutableGenerationState,
  remaps: ReadonlyMap<string, OriginFrameRemap>,
  requiredFrameWindow: BeatRange | 'all',
  outputEndBeat: number,
  preserveWriteMetadata: boolean,
): GeometryTimeline => {
  const targetOriginIds = new Set(remaps.keys());
  const nextTimeline = beginTimelineStage(state.timeline, outputEndBeat);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.timeline.sampleStepBeats,
    nextTimeline.frames.length,
  );

  stripOriginFrames(
    nextTimeline,
    Math.min(state.timeline.frames.length, nextTimeline.frames.length),
    targetOriginIds,
  );

  const sourceStrokesByOriginAndFrame = buildSourceStrokesByOriginAndFrame(
    state.timeline,
    targetOriginIds,
  );
  for (const [originId, remap] of remaps.entries()) {
    const sourceStrokesByFrame = sourceStrokesByOriginAndFrame.get(originId);
    if (!sourceStrokesByFrame) {
      continue;
    }

    for (
      let frameIndex = 0;
      frameIndex < Math.min(remap.sourceFrameIndexByOutputFrame.length, nextTimeline.frames.length);
      frameIndex += 1
    ) {
      if (!isFrameWithinWindow(frameIndex, frameWindow)) {
        continue;
      }

      const sourceFrameIndex = remap.sourceFrameIndexByOutputFrame[frameIndex];
      if (sourceFrameIndex === null || sourceFrameIndex === undefined) {
        continue;
      }

      const sourceStrokes = sourceStrokesByFrame.get(sourceFrameIndex);
      if (!sourceStrokes || sourceStrokes.length === 0) {
        continue;
      }

      for (const stroke of sourceStrokes) {
        if (preserveWriteMetadata) {
          addExistingStrokeToFrame(nextTimeline, frameIndex, stroke);
          continue;
        }

        addRemappedStrokeToFrame(nextTimeline, frameIndex, stroke, remap.writeOrder);
      }
    }
  }

  return completeTimelineStage(nextTimeline);
};

export const applyTemporalStateUpdates = (
  state: MutableGenerationState,
  temporalUpdates: ReadonlyMap<string, SceneTemporalState>,
  writeOrder: number,
): MutableGenerationState => {
  if (temporalUpdates.size === 0) {
    return state;
  }

  const timelineStateByOriginId = cloneTimelineStateByOriginId(state.timelineStateByOriginId);
  const pendingTemporalWriteOrderByOriginId = clonePendingTemporalWriteOrderByOriginId(
    state.pendingTemporalWriteOrderByOriginId,
  );

  for (const [originId, nextTemporal] of temporalUpdates.entries()) {
    const existing = timelineStateByOriginId.get(originId);
    if (!existing) {
      continue;
    }

    timelineStateByOriginId.set(originId, {
      observedWindow: cloneTimelineWindow(existing.observedWindow),
      temporal: cloneSceneTemporalState(nextTemporal),
    });
    pendingTemporalWriteOrderByOriginId.set(originId, writeOrder);
  }

  return {
    timeline: state.timeline,
    timelineStateByOriginId,
    pendingTemporalWriteOrderByOriginId,
    sealedOriginIds: cloneSealedOriginIds(state.sealedOriginIds),
  };
};

const buildNormalizeNonAuthoredRemaps = (
  state: MutableGenerationState,
): Map<string, OriginFrameRemap> => {
  const remaps = new Map<string, OriginFrameRemap>();
  const outputFrameCount = toFrameCount(FIXED_TIMELINE_END_BEAT, state.timeline.sampleStepBeats);

  for (const [originId, timelineState] of state.timelineStateByOriginId.entries()) {
    if (
      timelineState.temporal.hasAuthoredTimeline
      || state.sealedOriginIds.has(originId)
      || isWindowEmpty(timelineState.observedWindow)
      || !isFixedTimelineWindow(timelineState.temporal.visibilityWindow)
    ) {
      continue;
    }

    if (
      state.timeline.timeDomainEndBeat <= FIXED_TIMELINE_END_BEAT + TIMELINE_WINDOW_EPSILON
      && isFixedTimelineWindow(timelineState.observedWindow)
    ) {
      continue;
    }

    const sourceWindow = timelineState.observedWindow;
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

const buildPendingTemporalMaterializationRemaps = (
  state: MutableGenerationState,
): Map<string, OriginFrameRemap> => {
  const remaps = new Map<string, OriginFrameRemap>();
  const outputFrameCount = toFrameCount(FIXED_TIMELINE_END_BEAT, state.timeline.sampleStepBeats);

  for (const [originId, timelineState] of state.timelineStateByOriginId.entries()) {
    if (!hasPendingTemporalState(timelineState)) {
      continue;
    }

    const placementWindow = resolveTemporalPlacementWindow(timelineState);
    const placementSpan = placementWindow.end - placementWindow.start;
    const sourceFrameIndexByOutputFrame: Array<number | null> = !Number.isFinite(placementSpan) || placementSpan <= 0
      ? Array.from({ length: outputFrameCount }, (): number | null => null)
      : Array.from(
          { length: outputFrameCount },
          (_, frameIndex) => {
            const outputBeat = frameIndex * state.timeline.sampleStepBeats;
            if (outputBeat < placementWindow.start || outputBeat >= placementWindow.end) {
              return null;
            }

            const sourceBeat = evaluateTemporalRemap(timelineState.temporal.remap, outputBeat);
            if (sourceBeat === null || !Number.isFinite(sourceBeat)) {
              return null;
            }

            return toSourceFrameIndex(sourceBeat, state.timeline);
          },
        );

    remaps.set(originId, {
      nextTemporal: createMaterializedTemporalState(placementWindow),
      sourceFrameIndexByOutputFrame,
      writeOrder: state.pendingTemporalWriteOrderByOriginId.get(originId) ?? 0,
    });
  }

  return remaps;
};

export const materializePendingTemporalState = (
  state: MutableGenerationState,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const pendingOriginIds = new Set<string>();
  for (const [originId, timelineState] of state.timelineStateByOriginId.entries()) {
    if (hasPendingTemporalState(timelineState)) {
      pendingOriginIds.add(originId);
    }
  }
  if (pendingOriginIds.size === 0) {
    return state;
  }

  const remaps = buildPendingTemporalMaterializationRemaps(state);
  const timeline = remaps.size > 0
    ? remapTimeline(
        state,
        remaps,
        'all',
        FIXED_TIMELINE_END_BEAT,
        false,
      )
    : state.timeline;
  const pendingTemporalWriteOrderByOriginId = clonePendingTemporalWriteOrderByOriginId(
    state.pendingTemporalWriteOrderByOriginId,
  );
  for (const originId of pendingOriginIds) {
    pendingTemporalWriteOrderByOriginId.delete(originId);
  }

  return {
    timeline,
    timelineStateByOriginId: buildTimelineStateAfterTemporalMaterialization(
      timeline,
      state.timelineStateByOriginId,
      pendingOriginIds,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    ),
    pendingTemporalWriteOrderByOriginId,
    sealedOriginIds: cloneSealedOriginIds(state.sealedOriginIds),
  };
};

const clampTimelineToFixedLoop = (
  timeline: GeometryTimeline,
): GeometryTimeline => (
  timeline.timeDomainEndBeat <= FIXED_TIMELINE_END_BEAT + TIMELINE_WINDOW_EPSILON
    && timeline.frames.length === toFrameCount(FIXED_TIMELINE_END_BEAT, timeline.sampleStepBeats)
)
  ? timeline
  : completeTimelineStage(beginTimelineStage(timeline, FIXED_TIMELINE_END_BEAT));

export const sealStageWithTemporalInvariant = (
  state: MutableGenerationState,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const temporalOverrides = buildInvariantTemporalOverrides(state.timelineStateByOriginId);
  const normalizeRemaps = buildNormalizeNonAuthoredRemaps(state);
  const nextTimeline = normalizeRemaps.size > 0
    ? remapTimeline(
        state,
        normalizeRemaps,
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
    normalizeRemaps.size > 0
      ? new Map([
          ...temporalOverrides,
          ...Array.from(
            normalizeRemaps.entries(),
            ([originId, remap]) => [originId, remap.nextTemporal] as const,
          ),
        ])
      : temporalOverrides,
  );

  return {
    timeline: nextTimeline,
    timelineStateByOriginId,
    pendingTemporalWriteOrderByOriginId: normalizeRemaps.size > 0
      ? new Map<string, number>()
      : clonePendingTemporalWriteOrderByOriginId(state.pendingTemporalWriteOrderByOriginId),
    sealedOriginIds: new Set(timelineStateByOriginId.keys()),
  };
};

export const materializeRackOperatorInput: RackOperatorInputPreparation = (
  state: MutableGenerationState,
  context: RackStageExecutionContext,
): MutableGenerationState => materializePendingTemporalState(
  state,
  context.outputAdapter,
  context.mutedGroupIds,
  context.mutedGeneratorIds,
);

export const sealRackState = (
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
): MutableGenerationState => sealRackState(
  materializeRackOperatorInput(state, context),
  context,
);

export const prepareTemporalRackOperatorInput: RackOperatorInputPreparation = (
  state: MutableGenerationState,
  context: RackStageExecutionContext,
): MutableGenerationState => (
  state.timeline.timeDomainEndBeat <= FIXED_TIMELINE_END_BEAT + TIMELINE_WINDOW_EPSILON
    ? state
    : materializeAndSealRackState(state, context)
);

export const sealRackOperatorInput: RackOperatorInputPreparation = materializeAndSealRackState;
