import {
  type DeferredGenerationState,
  type MaterializedGenerationState,
  type MutableGenerationState,
  type OriginTimelineState,
  type PendingTemporalMaterializationCheckpoint,
} from '../../timeline/state';
import type {
  GeometryTimeline,
} from '../../types';
import type { TimelineWindow } from '../../timeline/temporal-window';
import {
  buildTimelineStateByOriginId,
} from './timeline-state';
import type {
  PendingFrameApplicationOperatorInput,
  RackOperator,
  RackOperatorInput,
  RackOperatorInputPolicy,
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
  baseState: DeferredGenerationState;
  sourceState: MaterializedGenerationState;
  precedingTemporalCheckpoint: PendingTemporalMaterializationCheckpoint | null;
}

export interface PendingGeometryApplicationOperatorInput {
  baseState: DeferredGenerationState;
  precedingTemporalCheckpoint: PendingTemporalMaterializationCheckpoint | null;
}

const materializePendingRackOperatorInput = (
  state: MutableGenerationState,
  context: RackStageExecutionContext,
): MaterializedGenerationState => {
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
  ) as MaterializedGenerationState;
};

export const prepareRackOperatorInput = <TPolicy extends RackOperatorInputPolicy>(
  policy: TPolicy,
  state: MutableGenerationState,
  context: RackStageExecutionContext,
): RackOperatorInput<TPolicy> => {
  switch (policy) {
    case 'preserve-pending':
      return state as RackOperatorInput<TPolicy>;
    case 'materialize-all':
      return materializePendingRackOperatorInput(state, context) as RackOperatorInput<TPolicy>;
  }
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
      : state as MaterializedGenerationState,
    precedingTemporalCheckpoint: pendingTemporalExtraction?.checkpoint ?? null,
  };
};

const preparePendingFrameApplicationInput = (
  state: MutableGenerationState,
  context: RackStageExecutionContext,
): PendingFrameApplicationOperatorInput => buildPendingFrameApplicationInputPlan(
  state,
  context,
);

const preparePendingGeometryApplicationInput = (
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
  playbackWindowOverrides: ReadonlyMap<string, TimelineWindow> = new Map(),
): MutableGenerationState => transitionGenerationState(state, {
  timeline,
  timelineStateByOriginId: applyFinalCleanupModeUpdate(
    buildTimelineStateByOriginId(
      timeline,
      timelineStateSeedByOriginId,
      context.outputAdapter,
      context.mutedGroupIds,
      context.mutedGeneratorIds,
      undefined,
      playbackWindowOverrides,
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

export const createPendingFrameApplicationOperator = <TKind extends RackStageDeviceKind>(
  execute: (
    input: PendingFrameApplicationOperatorInput,
    stage: RackStageOfKind<TKind>,
    context: RackStageExecutionContext,
  ) => MutableGenerationState,
): RackOperator => createRackOperator<TKind, 'preserve-pending'>(
  'preserve-pending',
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
): RackOperator => createRackOperator<TKind, 'preserve-pending'>(
  'preserve-pending',
  (state, stage, context) => execute(
    preparePendingGeometryApplicationInput(state),
    stage,
    context,
  ),
);
