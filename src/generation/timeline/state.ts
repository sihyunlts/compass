import { cloneSceneTemporalState } from '../../core/scene-operators/temporal';
import type {
  GenerationOriginTimelineState,
  GeometryTimeline,
} from '../types';

export type OriginTimelineState = GenerationOriginTimelineState;

export interface MutableGenerationState {
  timeline: GeometryTimeline;
  timelineStateByOriginId: Map<string, OriginTimelineState>;
  pendingTemporalWriteOrderByOriginId: Map<string, number>;
  sealedOriginIds: Set<string>;
}

export const cloneTimelineStateByOriginId = (
  timelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
): Map<string, OriginTimelineState> => new Map(
  Array.from(timelineStateByOriginId.entries(), ([originId, timelineState]) => [
    originId,
    {
      observedWindow: {
        start: timelineState.observedWindow.start,
        end: timelineState.observedWindow.end,
      },
      temporal: cloneSceneTemporalState(timelineState.temporal),
    },
  ]),
);

export const clonePendingTemporalWriteOrderByOriginId = (
  pendingTemporalWriteOrderByOriginId: ReadonlyMap<string, number>,
): Map<string, number> => new Map(pendingTemporalWriteOrderByOriginId);

export const cloneSealedOriginIds = (
  sealedOriginIds: ReadonlySet<string>,
): Set<string> => new Set(sealedOriginIds);
