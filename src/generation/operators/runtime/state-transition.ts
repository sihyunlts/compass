import type { MutableGenerationState } from '../../timeline/state';

interface GenerationStateTransitionOverrides {
  timeline?: MutableGenerationState['timeline'];
  timelineStateByOriginId?: MutableGenerationState['timelineStateByOriginId'];
  pendingFrameApplications?: MutableGenerationState['pendingFrameApplications'];
}

export const transitionGenerationState = (
  state: MutableGenerationState,
  overrides: GenerationStateTransitionOverrides = {},
): MutableGenerationState => ({
  timeline: overrides.timeline ?? state.timeline,
  timelineStateByOriginId: overrides.timelineStateByOriginId
    ?? state.timelineStateByOriginId,
  pendingFrameApplications: overrides.pendingFrameApplications
    ?? state.pendingFrameApplications,
});
