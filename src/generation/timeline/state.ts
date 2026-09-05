import type {
  GenerationOriginTimelineState,
  GeometryStroke,
  GeometryTimeline,
} from '../types';
import { createEmptyTimeline, DEFAULT_SAMPLE_STEP_BEATS } from './index';

export type OriginTimelineState = GenerationOriginTimelineState;

export interface PendingStrokeRewriteFrameWrite {
  readonly destinationFrameIndex: number;
  readonly strokes: ReadonlyArray<Omit<GeometryStroke, 'writeId'>>;
}

export interface PendingStrokeRewriteApplication {
  readonly kind: 'stroke-rewrite';
  readonly targetOriginIds: ReadonlySet<string>;
  readonly sourceFrameCount: number;
  readonly endBeat: number;
  readonly writes: ReadonlyArray<PendingStrokeRewriteFrameWrite>;
}

interface FrameGeometryRewriteInput {
  readonly sampleStepBeats: number;
  readonly frameIndex: number;
  readonly strokes: ReadonlyArray<GeometryStroke>;
}

export interface PendingGeometryRewriteApplication {
  readonly kind: 'geometry-rewrite';
  readonly targetOriginIds: ReadonlySet<string>;
  readonly rewriteFrameStrokes: (
    input: FrameGeometryRewriteInput,
  ) => ReadonlyArray<Omit<GeometryStroke, 'writeId'>>;
}

export type PendingFrameApplication =
  | PendingStrokeRewriteApplication
  | PendingGeometryRewriteApplication;

export interface GenerationState {
  readonly timeline: GeometryTimeline;
  readonly timelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>;
  readonly pendingFrameApplications: ReadonlyArray<PendingFrameApplication>;
}

declare const materializedGenerationStateBrand: unique symbol;

export type MaterializedGenerationState = GenerationState & {
  readonly [materializedGenerationStateBrand]: true;
};

export const createEmptyGenerationState = (
  sampleStepBeats = DEFAULT_SAMPLE_STEP_BEATS,
): GenerationState => ({
  timeline: createEmptyTimeline(sampleStepBeats),
  timelineStateByOriginId: new Map<string, OriginTimelineState>(),
  pendingFrameApplications: [],
});

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
      playbackExtent: {
        start: timelineState.playbackExtent.start,
        end: timelineState.playbackExtent.end,
      },
      timelineDomain: timelineState.timelineDomain,
    },
  ]),
);
