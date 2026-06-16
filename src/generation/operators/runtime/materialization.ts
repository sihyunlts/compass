import {
  type MutableGenerationState,
  type OriginTimelineState,
  type PendingTemporalMaterializationCheckpoint,
} from '../../timeline/state';
import type {
  GeometryTimeline,
} from '../../types';
import {
  buildTimelineStateByOriginId,
} from './timeline-state';
import type {
  PendingFrameApplicationOperatorInput,
  RackOperator,
  RackOperatorInputPreparation,
  RackStageExecutionContext,
  RackStageOfKind,
} from './types';
import { createRackOperator } from './types';
import type { RackStageDeviceKind } from '../../plan/types';
import { materializePendingFrameApplications } from './pending-frame-applications';
import {
  extractPendingTemporalCheckpoint,
  materializePendingTemporalState,
} from './pending-temporal';
import {
  applyFinalCleanupModeUpdate,
  transitionGenerationState,
} from './state-transition';
import { applyFinalTimelineNormalization } from './final-normalization';

interface PendingFrameApplicationInputPlan {
  baseState: MutableGenerationState;
  sourceState: MutableGenerationState;
  precedingTemporalCheckpoint: PendingTemporalMaterializationCheckpoint | null;
}

export interface PendingGeometryApplicationOperatorInput {
  baseState: MutableGenerationState;
  precedingTemporalCheckpoint: PendingTemporalMaterializationCheckpoint | null;
}

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

const buildPendingFrameApplicationInputPlan = (
  state: MutableGenerationState,
  context: RackStageExecutionContext,
): PendingFrameApplicationInputPlan => {
  const pendingTemporalExtraction = extractPendingTemporalCheckpoint(state);
  const baseState = pendingTemporalExtraction?.state ?? state;
  const needsSourceMaterialization = pendingTemporalExtraction !== null
    || state.pendingFrameApplications.length > 0;

  return {
    baseState,
    sourceState: needsSourceMaterialization
      ? materializePendingRackOperatorInput(state, context)
      : state,
    precedingTemporalCheckpoint: pendingTemporalExtraction?.checkpoint ?? null,
  };
};

export const preparePendingFrameApplicationInput = (
  state: MutableGenerationState,
  context: RackStageExecutionContext,
): PendingFrameApplicationOperatorInput => buildPendingFrameApplicationInputPlan(
  state,
  context,
);

export const preparePendingGeometryApplicationInput = (
  state: MutableGenerationState,
): PendingGeometryApplicationOperatorInput => {
  const pendingTemporalExtraction = extractPendingTemporalCheckpoint(state);

  return {
    baseState: pendingTemporalExtraction?.state ?? state,
    precedingTemporalCheckpoint: pendingTemporalExtraction?.checkpoint ?? null,
  };
};

export const replaceTimelineAndRefreshRackState = (
  state: MutableGenerationState,
  timeline: GeometryTimeline,
  timelineStateSeedByOriginId: ReadonlyMap<string, OriginTimelineState>,
  context: RackStageExecutionContext,
  unprotectedOriginIds: Iterable<string> = [],
): MutableGenerationState => transitionGenerationState(state, {
  timeline,
  timelineStateByOriginId: applyFinalCleanupModeUpdate(
    buildTimelineStateByOriginId(
      timeline,
      timelineStateSeedByOriginId,
      context.outputAdapter,
      context.mutedGroupIds,
      context.mutedGeneratorIds,
    ),
    { mode: 'cleanup', originIds: unprotectedOriginIds },
  ),
});

export const materializeAndNormalizeRackState = (
  state: MutableGenerationState,
  context: RackStageExecutionContext,
): MutableGenerationState => applyFinalTimelineNormalization(
  materializePendingRackOperatorInput(state, context),
  context.outputAdapter,
  context.mutedGroupIds,
  context.mutedGeneratorIds,
);

export const preservePendingRackOperatorInput: RackOperatorInputPreparation = (
  state: MutableGenerationState,
): MutableGenerationState => state;

export const createPendingFrameApplicationOperator = <TKind extends RackStageDeviceKind>(
  execute: (
    input: PendingFrameApplicationOperatorInput,
    stage: RackStageOfKind<TKind>,
    context: RackStageExecutionContext,
  ) => MutableGenerationState,
): RackOperator => createRackOperator<TKind>(
  preservePendingRackOperatorInput,
  (state, stage, context) => execute(
    preparePendingFrameApplicationInput(state, context),
    stage,
    context,
  ),
);

export const createPendingGeometryApplicationOperator = <TKind extends RackStageDeviceKind>(
  execute: (
    input: PendingGeometryApplicationOperatorInput,
    stage: RackStageOfKind<TKind>,
    context: RackStageExecutionContext,
  ) => MutableGenerationState,
): RackOperator => createRackOperator<TKind>(
  preservePendingRackOperatorInput,
  (state, stage, context) => execute(
    preparePendingGeometryApplicationInput(state),
    stage,
    context,
  ),
);
