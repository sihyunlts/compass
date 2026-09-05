import type { GenerationState } from '../../timeline/state';
import type { ModulationEvaluationWindow } from './modulation';
import { hasTimelineSpan } from './timeline-state';

export const buildModulationEvaluationWindowByOriginId = (
  state: GenerationState,
  targetOriginIds: ReadonlySet<string>,
  fallbackWindow: ModulationEvaluationWindow,
): ReadonlyMap<string, ModulationEvaluationWindow> => new Map(
  Array.from(targetOriginIds, (originId) => {
    const timelineState = state.timelineStateByOriginId.get(originId);
    const window = timelineState && hasTimelineSpan(timelineState.playbackExtent)
      ? timelineState.playbackExtent
      : timelineState?.observedWindow;
    return [
      originId,
      hasTimelineSpan(window)
        ? window
        : fallbackWindow,
    ] as const;
  }),
);
