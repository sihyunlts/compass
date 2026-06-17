import type { SceneTemporalState } from '../../../core/core-types';
import {
  cloneSceneTemporalState,
} from '../../../core/scene-operators/temporal';
import {
  clonePendingTemporalWriteOrderByOriginId,
  cloneTimelineStateByOriginId,
  type MutableGenerationState,
  type OriginTimelineState,
  type PendingTemporalMaterializationCheckpoint,
} from '../../timeline/state';
import {
  cloneTimelineWindow,
  createMaterializedTemporalState,
  hasPendingTemporalState,
  isFixedTimelineWindow,
  resolveTemporalPlacementWindow,
  resolveTemporalSourceWindow,
  TIMELINE_WINDOW_EPSILON,
  type TimelineWindow,
} from '../../timeline/temporal-window';
import type { FrameWindow } from '../../timeline';
import type {
  CanonicalOutputAdapter,
  GenerationFinalCleanupMode,
  GeometryTimeline,
} from '../../types';
import type { BeatRange } from '../../analysis/types';
import { buildTimelineStateAfterTemporalMaterialization } from './timeline-state';
import { buildTargetOriginIds } from './timeline-strokes';
import { resolveFrameWindow } from './frame-window';
import {
  createRackOperator,
  type OriginFrameRemap,
  type RackOperator,
  type RackStageExecutionContext,
  type RackStageOfKind,
} from './types';
import type { RackStageDeviceKind } from '../../plan/types';
import { transitionGenerationState } from './state-transition';
import { buildTemporalOriginFrameRemap } from './origin-frame-remap';
import {
  buildTimelineRemapPlan,
  createFixedTimelineRemapPolicy,
  type TimelineRemapPlan,
  type TimelineRemapPolicy,
} from './timeline-remap-plan';

interface PendingAwareTemporalOriginInput {
  originId: string;
  timelineState: OriginTimelineState;
  currentTemporal: SceneTemporalState;
  frameWindow: FrameWindow;
  placementWindow: TimelineWindow;
  sourceWindow: TimelineWindow;
}

const hasIdentityTemporalRemap = (
  temporal: SceneTemporalState,
): boolean => temporal.remap.kind === 'affine'
  && Math.abs(temporal.remap.alpha - 1) <= TIMELINE_WINDOW_EPSILON
  && Math.abs(temporal.remap.beta) <= TIMELINE_WINDOW_EPSILON;

const matchesObservedWindowCleanup = (
  temporal: SceneTemporalState,
  timelineState: OriginTimelineState,
): boolean => {
  if (temporal.remap.kind !== 'affine' || !isFixedTimelineWindow(temporal.visibilityWindow)) {
    return false;
  }

  const sourceWindow = timelineState.observedWindow;
  const sourceSpan = sourceWindow.end - sourceWindow.start;
  return sourceSpan > TIMELINE_WINDOW_EPSILON
    && Math.abs(temporal.remap.alpha - sourceSpan) <= TIMELINE_WINDOW_EPSILON
    && Math.abs(temporal.remap.beta - sourceWindow.start) <= TIMELINE_WINDOW_EPSILON;
};

const shouldDeferTemporalToFinalCleanup = (
  temporal: SceneTemporalState,
  timelineState: OriginTimelineState,
  finalCleanupMode: GenerationFinalCleanupMode,
): boolean => isFixedTimelineWindow(temporal.visibilityWindow)
  && finalCleanupMode === 'cleanup'
  && matchesObservedWindowCleanup(temporal, timelineState);

const shouldStoreMaterializedTemporalState = (
  temporal: SceneTemporalState,
  timelineState: OriginTimelineState,
  finalCleanupMode: GenerationFinalCleanupMode,
): boolean => isFixedTimelineWindow(temporal.visibilityWindow)
  && (
    hasIdentityTemporalRemap(temporal)
    || shouldDeferTemporalToFinalCleanup(temporal, timelineState, finalCleanupMode)
  );

const resolveStoredTemporalState = (
  temporal: SceneTemporalState,
  timelineState: OriginTimelineState,
  finalCleanupMode: GenerationFinalCleanupMode,
): SceneTemporalState => (
  shouldStoreMaterializedTemporalState(temporal, timelineState, finalCleanupMode)
    ? createMaterializedTemporalState(temporal.visibilityWindow)
    : cloneSceneTemporalState(temporal)
);

const hasPendingTemporalWrite = (
  temporal: SceneTemporalState,
): boolean => temporal.hasAuthoredTimeline || !hasIdentityTemporalRemap(temporal);

const resolvePendingAwareTemporalSourceWindow = (
  state: MutableGenerationState,
  originId: string,
  timelineState: OriginTimelineState,
): TimelineWindow | null => (
  hasPendingTemporalState(timelineState)
    ? resolveTemporalPlacementWindow(timelineState)
    : resolveTemporalSourceWindow(state.timelineStateByOriginId, originId)
);

const resolvePendingAwareCurrentTemporal = (
  timelineState: OriginTimelineState,
  sourceWindow: TimelineWindow,
): SceneTemporalState => {
  const currentTemporal = cloneSceneTemporalState(timelineState.temporal);
  if (hasPendingTemporalState(timelineState)) {
    return currentTemporal;
  }

  return {
    ...currentTemporal,
    visibilityWindow: cloneTimelineWindow(sourceWindow),
  };
};

export const buildTemporalStateUpdatesForTargetOrigins = (
  state: MutableGenerationState,
  targetGroupId: string | null,
  requiredFrameWindow: BeatRange | 'all',
  resolveTemporalState: (input: PendingAwareTemporalOriginInput) => SceneTemporalState | null,
): Map<string, SceneTemporalState> => {
  const temporalUpdates = new Map<string, SceneTemporalState>();
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.timeline.sampleStepBeats,
    state.timeline.frames.length,
  );

  for (const originId of buildTargetOriginIds(state.timeline, targetGroupId)) {
    const timelineState = state.timelineStateByOriginId.get(originId);
    if (!timelineState) {
      continue;
    }

    const sourceWindow = resolvePendingAwareTemporalSourceWindow(state, originId, timelineState);
    if (!sourceWindow) {
      continue;
    }

    const nextTemporal = resolveTemporalState({
      originId,
      timelineState,
      currentTemporal: resolvePendingAwareCurrentTemporal(timelineState, sourceWindow),
      frameWindow,
      placementWindow: resolveTemporalPlacementWindow(timelineState),
      sourceWindow,
    });
    if (nextTemporal) {
      temporalUpdates.set(originId, nextTemporal);
    }
  }

  return temporalUpdates;
};

const applyTemporalStateUpdates = (
  state: MutableGenerationState,
  temporalUpdates: ReadonlyMap<string, SceneTemporalState>,
  writeOrder: number,
  finalCleanupMode?: GenerationFinalCleanupMode,
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

    const nextFinalCleanupMode = finalCleanupMode ?? existing.finalCleanupMode;
    const nextStoredTemporal = resolveStoredTemporalState(
      nextTemporal,
      existing,
      nextFinalCleanupMode,
    );
    timelineStateByOriginId.set(originId, {
      observedWindow: cloneTimelineWindow(existing.observedWindow),
      playbackWindow: cloneTimelineWindow(existing.playbackWindow),
      temporal: nextStoredTemporal,
      finalCleanupMode: nextFinalCleanupMode,
    });

    if (hasPendingTemporalWrite(nextStoredTemporal)) {
      pendingTemporalWriteOrderByOriginId.set(originId, writeOrder);
    } else {
      pendingTemporalWriteOrderByOriginId.delete(originId);
    }
  }

  return transitionGenerationState(state, {
    timelineStateByOriginId,
    pendingTemporalWriteOrderByOriginId,
  });
};

export const createTemporalStateUpdateOperator = <TKind extends RackStageDeviceKind>(
  buildTemporalUpdates: (
    state: MutableGenerationState,
    stage: RackStageOfKind<TKind>,
    context: RackStageExecutionContext,
  ) => ReadonlyMap<string, SceneTemporalState>,
  finalCleanupMode?: GenerationFinalCleanupMode,
): RackOperator => createRackOperator<TKind>(
  (state) => state,
  (state, stage, context) => applyTemporalStateUpdates(
    state,
    buildTemporalUpdates(state, stage, context),
    stage.stageIndex,
    finalCleanupMode,
  ),
);

const buildTemporalMaterializationRemaps = (
  timeline: GeometryTimeline,
  outputEndBeat: number,
  temporalByOriginId: ReadonlyMap<string, SceneTemporalState>,
  writeOrderByOriginId: ReadonlyMap<string, number>,
): Map<string, OriginFrameRemap> => {
  const remaps = new Map<string, OriginFrameRemap>();

  for (const [originId, temporal] of temporalByOriginId.entries()) {
    remaps.set(
      originId,
      buildTemporalOriginFrameRemap(
        timeline,
        outputEndBeat,
        temporal,
        writeOrderByOriginId.get(originId) ?? 0,
      ),
    );
  }

  return remaps;
};

interface TemporalMaterializationPlan extends TimelineRemapPlan {
  materializedTemporalByOriginId: ReadonlyMap<string, SceneTemporalState>;
}

const buildTemporalMaterializationPlan = (
  timeline: GeometryTimeline,
  remapPolicy: TimelineRemapPolicy,
  temporalByOriginId: ReadonlyMap<string, SceneTemporalState>,
  writeOrderByOriginId: ReadonlyMap<string, number>,
): TemporalMaterializationPlan => {
  const originRemaps = buildTemporalMaterializationRemaps(
    timeline,
    remapPolicy.outputEndBeat,
    temporalByOriginId,
    writeOrderByOriginId,
  );
  const remapPlan = buildTimelineRemapPlan(timeline, originRemaps, remapPolicy);

  return {
    ...remapPlan,
    materializedTemporalByOriginId: new Map(
      Array.from(originRemaps.entries(), ([originId, remap]) => [originId, remap.nextTemporal] as const),
    ),
  };
};

interface PendingTemporalMaterializationPlan extends TemporalMaterializationPlan {
  pendingTemporalWriteOrderByOriginId: Map<string, number>;
}

interface PendingTemporalCheckpointExtractionPlan {
  checkpoint: PendingTemporalMaterializationCheckpoint;
  timelineStateByOriginId: Map<string, OriginTimelineState>;
  pendingTemporalWriteOrderByOriginId: Map<string, number>;
}

const buildPendingTemporalByOriginId = (
  timelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
): Map<string, SceneTemporalState> => {
  const temporalByOriginId = new Map<string, SceneTemporalState>();
  for (const [originId, timelineState] of timelineStateByOriginId.entries()) {
    if (hasPendingTemporalState(timelineState)) {
      temporalByOriginId.set(originId, timelineState.temporal);
    }
  }

  return temporalByOriginId;
};

const buildPendingTemporalWriteOrderAfterMaterialization = (
  state: MutableGenerationState,
  materializedOriginIds: ReadonlySet<string>,
): Map<string, number> => {
  const pendingTemporalWriteOrderByOriginId = clonePendingTemporalWriteOrderByOriginId(
    state.pendingTemporalWriteOrderByOriginId,
  );
  for (const originId of materializedOriginIds) {
    pendingTemporalWriteOrderByOriginId.delete(originId);
  }

  return pendingTemporalWriteOrderByOriginId;
};

const buildPendingTemporalMaterializationPlan = (
  state: MutableGenerationState,
): PendingTemporalMaterializationPlan => {
  const materializationPlan = buildTemporalMaterializationPlan(
    state.timeline,
    createFixedTimelineRemapPolicy(),
    buildPendingTemporalByOriginId(state.timelineStateByOriginId),
    state.pendingTemporalWriteOrderByOriginId,
  );

  return {
    ...materializationPlan,
    pendingTemporalWriteOrderByOriginId: buildPendingTemporalWriteOrderAfterMaterialization(
      state,
      materializationPlan.originIds,
    ),
  };
};

export const materializeTemporalCheckpointTimeline = (
  timeline: GeometryTimeline,
  checkpoint: PendingTemporalMaterializationCheckpoint,
): GeometryTimeline => {
  const materializationPlan = buildTemporalMaterializationPlan(
    timeline,
    createFixedTimelineRemapPolicy(),
    checkpoint.temporalByOriginId,
    checkpoint.writeOrderByOriginId,
  );

  return materializationPlan.timeline;
};

const buildPendingTemporalCheckpointExtractionPlan = (
  state: MutableGenerationState,
): PendingTemporalCheckpointExtractionPlan | null => {
  const temporalByOriginId = new Map<string, SceneTemporalState>();
  const writeOrderByOriginId = new Map<string, number>();
  const timelineStateByOriginId = cloneTimelineStateByOriginId(state.timelineStateByOriginId);
  const pendingTemporalWriteOrderByOriginId = clonePendingTemporalWriteOrderByOriginId(
    state.pendingTemporalWriteOrderByOriginId,
  );

  for (const [originId, timelineState] of timelineStateByOriginId.entries()) {
    if (!hasPendingTemporalState(timelineState)) {
      continue;
    }

    temporalByOriginId.set(originId, cloneSceneTemporalState(timelineState.temporal));
    writeOrderByOriginId.set(originId, pendingTemporalWriteOrderByOriginId.get(originId) ?? 0);
    timelineStateByOriginId.set(originId, {
      observedWindow: cloneTimelineWindow(timelineState.observedWindow),
      playbackWindow: cloneTimelineWindow(timelineState.playbackWindow),
      temporal: createMaterializedTemporalState(resolveTemporalPlacementWindow(timelineState)),
      finalCleanupMode: timelineState.finalCleanupMode,
    });
    pendingTemporalWriteOrderByOriginId.delete(originId);
  }

  if (temporalByOriginId.size === 0) {
    return null;
  }

  return {
    checkpoint: {
      temporalByOriginId,
      writeOrderByOriginId,
    },
    timelineStateByOriginId,
    pendingTemporalWriteOrderByOriginId,
  };
};

export const extractPendingTemporalCheckpoint = (
  state: MutableGenerationState,
): {
  checkpoint: PendingTemporalMaterializationCheckpoint;
  state: MutableGenerationState;
} | null => {
  const extractionPlan = buildPendingTemporalCheckpointExtractionPlan(state);
  if (!extractionPlan) {
    return null;
  }

  return {
    checkpoint: extractionPlan.checkpoint,
    state: transitionGenerationState(state, {
      timelineStateByOriginId: extractionPlan.timelineStateByOriginId,
      pendingTemporalWriteOrderByOriginId: extractionPlan.pendingTemporalWriteOrderByOriginId,
    }),
  };
};

export const materializePendingTemporalState = (
  state: MutableGenerationState,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const materializationPlan = buildPendingTemporalMaterializationPlan(state);
  if (materializationPlan.originIds.size === 0) {
    return state;
  }

  return transitionGenerationState(state, {
    timeline: materializationPlan.timeline,
    timelineStateByOriginId: buildTimelineStateAfterTemporalMaterialization(
      materializationPlan.timeline,
      state.timelineStateByOriginId,
      materializationPlan.originIds,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
      materializationPlan.materializedTemporalByOriginId,
    ),
    pendingTemporalWriteOrderByOriginId: materializationPlan.pendingTemporalWriteOrderByOriginId,
  });
};
