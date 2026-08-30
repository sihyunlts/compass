import type { PendingGeometryApplicationOperatorInput } from './materialization';
import type { ModulationEvaluationWindow } from './modulation';

export const buildModulationEvaluationWindowByOriginId = (
  input: PendingGeometryApplicationOperatorInput,
  targetOriginIds: ReadonlySet<string>,
  fallbackWindow: ModulationEvaluationWindow,
): ReadonlyMap<string, ModulationEvaluationWindow> => new Map(
  Array.from(targetOriginIds, (originId) => {
    const timelineState = input.baseState.timelineStateByOriginId.get(originId);
    const window = input.precedingTemporalCheckpoint?.temporalByOriginId.has(originId)
      ? timelineState?.temporal.visibilityWindow
      : timelineState?.playbackWindow;
    return [
      originId,
      window && Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > window.start
        ? window
        : fallbackWindow,
    ] as const;
  }),
);
