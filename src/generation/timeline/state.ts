import { cloneSceneTemporalState } from '../../core/scene-operators/temporal';
import type { SceneTemporalState } from '../../core/core-types';
import type { BeatRange } from '../analysis/types';
import type {
  GenerationOriginTimelineState,
  GeometryStroke,
  GeometryTimeline,
} from '../types';
import type { ColorDeviceConfig } from '../../devices/color/color-program';
import { createEmptyTimeline } from './index';

export type OriginTimelineState = GenerationOriginTimelineState;

export interface PendingTemporalMaterializationCheckpoint {
  temporalByOriginId: ReadonlyMap<string, SceneTemporalState>;
  writeOrderByOriginId: ReadonlyMap<string, number>;
}

export interface PendingColorApplication {
  kind: 'color';
  precedingTemporalCheckpoint: PendingTemporalMaterializationCheckpoint | null;
  targetOriginIds: ReadonlySet<string>;
  targetGroupId: string | null;
  requiredFrameWindow: BeatRange | 'all';
  colorConfig: ColorDeviceConfig;
  writeOrder: number;
}

export interface PendingStrokeRewriteFrameWrite {
  destinationFrameIndex: number;
  strokes: ReadonlyArray<Omit<GeometryStroke, 'writeId'>>;
}

export interface PendingStrokeRewriteApplication {
  kind: 'stroke-rewrite';
  precedingTemporalCheckpoint: PendingTemporalMaterializationCheckpoint | null;
  targetOriginIds: ReadonlySet<string>;
  sourceFrameCount: number;
  endBeat: number;
  writes: ReadonlyArray<PendingStrokeRewriteFrameWrite>;
}

export interface PendingGeometryRewriteInput {
  timeline: GeometryTimeline;
  frameIndex: number;
  strokes: ReadonlyArray<GeometryStroke>;
}

export interface PendingGeometryRewriteApplication {
  kind: 'geometry-rewrite';
  precedingTemporalCheckpoint: PendingTemporalMaterializationCheckpoint | null;
  targetOriginIds: ReadonlySet<string>;
  requiredFrameWindow: BeatRange | 'all';
  rewriteFrameStrokes: (
    input: PendingGeometryRewriteInput,
  ) => ReadonlyArray<Omit<GeometryStroke, 'writeId'>>;
}

export type PendingFrameApplication =
  | PendingColorApplication
  | PendingStrokeRewriteApplication
  | PendingGeometryRewriteApplication;

export interface MutableGenerationState {
  timeline: GeometryTimeline;
  timelineStateByOriginId: Map<string, OriginTimelineState>;
  pendingTemporalWriteOrderByOriginId: Map<string, number>;
  pendingFrameApplications: PendingFrameApplication[];
}

export const createEmptyGenerationState = (): MutableGenerationState => ({
  timeline: createEmptyTimeline(),
  timelineStateByOriginId: new Map<string, OriginTimelineState>(),
  pendingTemporalWriteOrderByOriginId: new Map<string, number>(),
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
      playbackWindow: {
        start: timelineState.playbackWindow.start,
        end: timelineState.playbackWindow.end,
      },
      temporal: cloneSceneTemporalState(timelineState.temporal),
      finalCleanupMode: timelineState.finalCleanupMode,
    },
  ]),
);

export const clonePendingTemporalWriteOrderByOriginId = (
  pendingTemporalWriteOrderByOriginId: ReadonlyMap<string, number>,
): Map<string, number> => new Map(pendingTemporalWriteOrderByOriginId);

const clonePendingStroke = (
  stroke: Omit<GeometryStroke, 'writeId'>,
): Omit<GeometryStroke, 'writeId'> => ({
  polyline: {
    ...stroke.polyline,
    points: stroke.polyline.points.map((point) => ({ ...point })),
    clipStack: stroke.polyline.clipStack.map((clip) => ({
      ...clip,
      inverseTransform: { ...clip.inverseTransform },
    })),
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
  const precedingTemporalCheckpoint = application.precedingTemporalCheckpoint
    ? {
        temporalByOriginId: new Map(
          Array.from(application.precedingTemporalCheckpoint.temporalByOriginId.entries(), ([originId, temporal]) => [
            originId,
            cloneSceneTemporalState(temporal),
          ]),
        ),
        writeOrderByOriginId: new Map(application.precedingTemporalCheckpoint.writeOrderByOriginId),
      }
    : null;

  if (application.kind === 'geometry-rewrite') {
    return {
      kind: 'geometry-rewrite',
      precedingTemporalCheckpoint,
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

  if (application.kind === 'stroke-rewrite') {
    return {
      kind: 'stroke-rewrite',
      precedingTemporalCheckpoint,
      targetOriginIds: new Set(application.targetOriginIds),
      sourceFrameCount: application.sourceFrameCount,
      endBeat: application.endBeat,
      writes: application.writes.map((write) => ({
        destinationFrameIndex: write.destinationFrameIndex,
        strokes: write.strokes.map(clonePendingStroke),
      })),
    };
  }

  return {
    kind: 'color',
    precedingTemporalCheckpoint,
    targetOriginIds: new Set(application.targetOriginIds),
    targetGroupId: application.targetGroupId,
    requiredFrameWindow: application.requiredFrameWindow === 'all'
      ? 'all'
      : {
          start: application.requiredFrameWindow.start,
          end: application.requiredFrameWindow.end,
        },
    colorConfig: {
      velocities: [...application.colorConfig.velocities],
      noteLengthPercent: application.colorConfig.noteLengthPercent,
      gapPercent: application.colorConfig.gapPercent,
    },
    writeOrder: application.writeOrder,
  };
});
