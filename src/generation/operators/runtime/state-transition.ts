import type { GenerationState } from '../../timeline/state';

interface GenerationStateTransitionOverrides {
  timeline?: GenerationState['timeline'];
  timelineStateByOriginId?: GenerationState['timelineStateByOriginId'];
  pendingFrameApplications?: GenerationState['pendingFrameApplications'];
}

export const transitionGenerationState = (
  state: GenerationState,
  overrides: GenerationStateTransitionOverrides = {},
): GenerationState => ({
  timeline: overrides.timeline ?? state.timeline,
  timelineStateByOriginId: overrides.timelineStateByOriginId
    ?? state.timelineStateByOriginId,
  pendingFrameApplications: overrides.pendingFrameApplications
    ?? state.pendingFrameApplications,
});
