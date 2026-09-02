import {
  type DeferredGenerationState,
  type MaterializedGenerationState,
  type MutableGenerationState,
  type OriginTimelineState,
} from '../../timeline/state';
import type { GeometryTimeline } from '../../types';
import {
  buildTimelineStateByOriginId,
  type OriginTimelineStateOverride,
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
import { transitionGenerationState } from './state-transition';
import { applyFinalTimelineNormalization } from './final-normalization';

export interface PendingGeometryApplicationOperatorInput {
  baseState: DeferredGenerationState;
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

  return frameMaterializedState as MaterializedGenerationState;
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

const preparePendingFrameApplicationInput = (
  state: MutableGenerationState,
  context: RackStageExecutionContext,
): PendingFrameApplicationOperatorInput => ({
  baseState: state,
  sourceState: state.pendingFrameApplications.length > 0
    ? materializePendingRackOperatorInput(state, context)
    : state as MaterializedGenerationState,
});

export const replaceTimelineAndRefreshRackState = (
  state: MutableGenerationState,
  timeline: GeometryTimeline,
  timelineStateSeedByOriginId: ReadonlyMap<string, OriginTimelineState>,
  context: RackStageExecutionContext,
  timelineStateOverrides: ReadonlyMap<string, OriginTimelineStateOverride> = new Map(),
): MutableGenerationState => transitionGenerationState(state, {
  timeline,
  timelineStateByOriginId: buildTimelineStateByOriginId(
    timeline,
    timelineStateSeedByOriginId,
    context.outputAdapter,
    context.mutedGroupIds,
    context.mutedGeneratorIds,
    timelineStateOverrides,
  ),
});

export const materializeAndNormalizeRackTimeline = (
  state: MutableGenerationState,
  context: RackStageExecutionContext,
): GeometryTimeline => applyFinalTimelineNormalization(
  materializePendingRackOperatorInput(state, context),
);

export const createPendingFrameApplicationOperator = <TKind extends RackStageDeviceKind>(
  execute: (
    input: PendingFrameApplicationOperatorInput,
    stage: RackStageOfKind<TKind>,
    context: RackStageExecutionContext,
  ) => MutableGenerationState,
  outputPolicy: 'defer' | 'publish-timeline-state' = 'defer',
): RackOperator => createRackOperator<TKind, 'preserve-pending'>(
  'preserve-pending',
  (state, stage, context) => {
    const nextState = execute(
      preparePendingFrameApplicationInput(state, context),
      stage,
      context,
    );

    return outputPolicy === 'publish-timeline-state'
      ? materializePendingFrameApplications(
          nextState,
          context.outputAdapter,
          context.mutedGroupIds,
          context.mutedGeneratorIds,
        )
      : nextState;
  },
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
    { baseState: state },
    stage,
    context,
  ),
);
