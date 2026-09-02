import type { BeatRange } from '../analysis/types';
import type {
  GenerationOriginTimelineState,
  GeometryStroke,
  GeometryTimeline,
} from '../types';
import { createEmptyTimeline, DEFAULT_SAMPLE_STEP_BEATS } from './index';

export type OriginTimelineState = GenerationOriginTimelineState;

export interface PendingStrokeRewriteFrameWrite {
  destinationFrameIndex: number;
  strokes: ReadonlyArray<Omit<GeometryStroke, 'writeId'>>;
}

export interface PendingStrokeRewriteApplication {
  kind: 'stroke-rewrite';
  targetOriginIds: ReadonlySet<string>;
  sourceFrameCount: number;
  endBeat: number;
  writes: ReadonlyArray<PendingStrokeRewriteFrameWrite>;
}

interface MaterializedGeometryRewriteInput {
  readonly timeline: GeometryTimeline;
  readonly frameIndex: number;
  readonly strokes: ReadonlyArray<GeometryStroke>;
}

export interface PendingGeometryRewriteApplication {
  kind: 'geometry-rewrite';
  targetOriginIds: ReadonlySet<string>;
  requiredFrameWindow: BeatRange | 'all';
  rewriteFrameStrokes: (
    input: MaterializedGeometryRewriteInput,
  ) => ReadonlyArray<Omit<GeometryStroke, 'writeId'>>;
}

export type PendingFrameApplication =
  | PendingStrokeRewriteApplication
  | PendingGeometryRewriteApplication;

export interface DeferredGenerationState {
  timeline: GeometryTimeline;
  timelineStateByOriginId: Map<string, OriginTimelineState>;
  pendingFrameApplications: PendingFrameApplication[];
}

export type MutableGenerationState = DeferredGenerationState;

declare const materializedGenerationStateBrand: unique symbol;

export type MaterializedGenerationState = DeferredGenerationState & {
  readonly [materializedGenerationStateBrand]: true;
};

export const createEmptyGenerationState = (
  sampleStepBeats = DEFAULT_SAMPLE_STEP_BEATS,
): MutableGenerationState => ({
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

const clonePendingStroke = (
  stroke: Omit<GeometryStroke, 'writeId'>,
): Omit<GeometryStroke, 'writeId'> => ({
  polyline: {
    ...stroke.polyline,
    points: stroke.polyline.points.map((point) => ({ ...point })),
  },
  originGroupId: stroke.originGroupId,
  writeOrder: stroke.writeOrder,
  masks: stroke.masks.map((mask) => ({
    contains: mask.contains,
    inverseTransform: { ...mask.inverseTransform },
  })),
});

export const clonePendingFrameApplications = (
  pendingFrameApplications: ReadonlyArray<PendingFrameApplication>,
): PendingFrameApplication[] => pendingFrameApplications.map((application) => {
  if (application.kind === 'geometry-rewrite') {
    return {
      kind: 'geometry-rewrite',
      targetOriginIds: new Set(application.targetOriginIds),
      requiredFrameWindow: application.requiredFrameWindow === 'all'
        ? 'all'
        : {
            start: application.requiredFrameWindow.start,
            end: application.requiredFrameWindow.end,
          },
      rewriteFrameStrokes: application.rewriteFrameStrokes,
    };
  }

  return {
    kind: 'stroke-rewrite',
    targetOriginIds: new Set(application.targetOriginIds),
    sourceFrameCount: application.sourceFrameCount,
    endBeat: application.endBeat,
    writes: application.writes.map((write) => ({
      destinationFrameIndex: write.destinationFrameIndex,
      strokes: write.strokes.map(clonePendingStroke),
    })),
  };
});
