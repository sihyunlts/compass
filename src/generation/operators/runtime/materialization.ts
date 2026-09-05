import {
  type MaterializedGenerationState,
  type GenerationState,
  type OriginTimelineState,
} from '../../timeline/state';
import type { GeometryTimeline } from '../../types';
import {
  buildTimelineStateByOriginId,
  type OriginTimelineStateOverride,
} from './timeline-state';
import type {
  RackOperatorInput,
  RackOperatorInputPolicy,
  RackStageExecutionContext,
} from './types';
import { materializePendingFrameApplications } from './pending-frame-applications';
import { transitionGenerationState } from './state-transition';
import { applyFinalTimelineNormalization } from './final-normalization';

export const materializeRackState = (
  state: GenerationState,
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
  state: GenerationState,
  context: RackStageExecutionContext,
): RackOperatorInput<TPolicy> => {
  switch (policy) {
    case 'preserve-pending':
      return state as RackOperatorInput<TPolicy>;
    case 'materialize-all':
      return materializeRackState(state, context) as RackOperatorInput<TPolicy>;
  }
};

export const replaceTimelineAndRefreshRackState = (
  state: GenerationState,
  timeline: GeometryTimeline,
  timelineStateSeedByOriginId: ReadonlyMap<string, OriginTimelineState>,
  context: RackStageExecutionContext,
  timelineStateOverrides: ReadonlyMap<string, OriginTimelineStateOverride> = new Map(),
): GenerationState => transitionGenerationState(state, {
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
  state: GenerationState,
  context: RackStageExecutionContext,
): GeometryTimeline => applyFinalTimelineNormalization(
  materializeRackState(state, context),
);
