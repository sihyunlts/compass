import {
  clonePendingFrameApplications,
  clonePendingTemporalWriteOrderByOriginId,
  cloneTimelineStateByOriginId,
  type MutableGenerationState,
  type OriginTimelineState,
} from '../../timeline/state';
import type { GenerationFinalCleanupMode } from '../../types';

export interface GenerationStateTransitionOverrides {
  timeline?: MutableGenerationState['timeline'];
  timelineStateByOriginId?: MutableGenerationState['timelineStateByOriginId'];
  pendingTemporalWriteOrderByOriginId?: MutableGenerationState['pendingTemporalWriteOrderByOriginId'];
  pendingFrameApplications?: MutableGenerationState['pendingFrameApplications'];
}

export interface FinalCleanupModeUpdate {
  mode: GenerationFinalCleanupMode;
  originIds: Iterable<string>;
}

export const applyFinalCleanupModeUpdate = (
  timelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
  update: FinalCleanupModeUpdate,
): Map<string, OriginTimelineState> => {
  const nextTimelineStateByOriginId = cloneTimelineStateByOriginId(timelineStateByOriginId);

  for (const originId of update.originIds) {
    const current = nextTimelineStateByOriginId.get(originId);
    if (!current) {
      continue;
    }

    nextTimelineStateByOriginId.set(originId, {
      ...current,
      finalCleanupMode: update.mode,
    });
  }

  return nextTimelineStateByOriginId;
};

export const transitionGenerationState = (
  state: MutableGenerationState,
  overrides: GenerationStateTransitionOverrides = {},
): MutableGenerationState => ({
  timeline: overrides.timeline ?? state.timeline,
  timelineStateByOriginId: overrides.timelineStateByOriginId
    ?? cloneTimelineStateByOriginId(state.timelineStateByOriginId),
  pendingTemporalWriteOrderByOriginId: overrides.pendingTemporalWriteOrderByOriginId
    ?? clonePendingTemporalWriteOrderByOriginId(state.pendingTemporalWriteOrderByOriginId),
  pendingFrameApplications: overrides.pendingFrameApplications
    ?? clonePendingFrameApplications(state.pendingFrameApplications),
});
