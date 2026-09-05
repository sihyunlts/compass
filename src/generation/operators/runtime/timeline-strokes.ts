import { iterateTimelineFrames } from '../../timeline';
import type { AffineTransform } from '../../../core/core-types';
import {
  applyTransformToPolyline,
  composeAffine,
  resolveFixedPointAffinePullback,
} from '../../../core/geometry';
import type {
  GeometryMask,
  GeometryStroke,
  GeometryTimeline,
} from '../../types';

const isTargetedStroke = (
  stroke: GeometryStroke,
  targetGroupId: string | null,
): boolean => targetGroupId === null || stroke.originGroupId === targetGroupId;

export const buildTargetOriginIds = (
  timeline: GeometryTimeline,
  targetGroupId: string | null,
  options: {
    excludeMutedSources?: boolean;
    mutedGroupIds?: ReadonlySet<string>;
    mutedGeneratorIds?: ReadonlySet<string>;
  } = {},
): Set<string> => {
  const originIds = new Set<string>();
  const excludeMutedSources = options.excludeMutedSources === true;
  const mutedGroupIds = options.mutedGroupIds ?? new Set<string>();
  const mutedGeneratorIds = options.mutedGeneratorIds ?? new Set<string>();

  if (timeline.originGroupIdByOriginId.size > 0) {
    for (const [originId, originGroupId] of timeline.originGroupIdByOriginId.entries()) {
      if (targetGroupId !== null && originGroupId !== targetGroupId) {
        continue;
      }

      if (
        excludeMutedSources
        && (
          mutedGeneratorIds.has(originId)
          || (originGroupId !== null && mutedGroupIds.has(originGroupId))
        )
      ) {
        continue;
      }

      originIds.add(originId);
    }

    return originIds;
  }

  for (const { stroke } of timeline.placements) {
    if (!isTargetedStroke(stroke, targetGroupId)) {
      continue;
    }

    if (
      excludeMutedSources
      && (
        mutedGeneratorIds.has(stroke.polyline.originId)
        || (stroke.originGroupId !== null && mutedGroupIds.has(stroke.originGroupId))
      )
    ) {
      continue;
    }

    originIds.add(stroke.polyline.originId);
  }

  return originIds;
};

const resolveIntraWriteOrder = (
  writeOrder: number,
): number => {
  if (!Number.isFinite(writeOrder)) {
    return 0;
  }

  const baseOrder = Math.trunc(writeOrder);
  return writeOrder - baseOrder;
};

const resolveStageWriteOrder = (
  writeOrder: number,
  stroke: GeometryStroke,
): number => writeOrder + resolveIntraWriteOrder(stroke.writeOrder);

const transformMask = (
  mask: GeometryMask,
  transform: AffineTransform,
): GeometryMask => {
  const pullback = resolveFixedPointAffinePullback(transform);
  if (!pullback) {
    return mask;
  }

  return {
    contains: mask.contains,
    inverseTransform: composeAffine(mask.inverseTransform, pullback),
  };
};

export const transformStroke = (
  stroke: GeometryStroke,
  transform: AffineTransform | null,
  writeOrder: number,
): Omit<GeometryStroke, 'writeId'> => {
  const polyline = transform
    ? applyTransformToPolyline(stroke.polyline, transform)
    // Temporal remaps and identity spatial rewrites change placement metadata,
    // not geometry. Canonical strokes are immutable snapshots, so preserving
    // the polyline identity lets downstream projection reuse its occupancy.
    : stroke.polyline;
  return {
    polyline,
    originGroupId: stroke.originGroupId,
    writeOrder: resolveStageWriteOrder(writeOrder, stroke),
    masks: transform
      ? stroke.masks.map((mask) => transformMask(mask, transform))
      : stroke.masks,
  };
};

export const buildSourceStrokesByOriginAndFrame = (
  timeline: GeometryTimeline,
  targetOriginIds: ReadonlySet<string>,
): Map<string, Map<number, GeometryStroke[]>> => {
  const strokesByOriginId = new Map<string, Map<number, GeometryStroke[]>>();

  for (const { frameIndex, strokes } of iterateTimelineFrames(timeline, undefined, targetOriginIds)) {
    for (const stroke of strokes) {
      if (!targetOriginIds.has(stroke.polyline.originId)) {
        continue;
      }

      let frameMap = strokesByOriginId.get(stroke.polyline.originId);
      if (!frameMap) {
        frameMap = new Map<number, GeometryStroke[]>();
        strokesByOriginId.set(stroke.polyline.originId, frameMap);
      }

      let frameStrokes = frameMap.get(frameIndex);
      if (!frameStrokes) {
        frameStrokes = [];
        frameMap.set(frameIndex, frameStrokes);
      }

      frameStrokes.push(stroke);
    }
  }

  return strokesByOriginId;
};

export const toSourceFrameIndex = (
  beat: number,
  timeline: GeometryTimeline,
): number => {
  const frameCount = Math.max(timeline.frameCount, 1);
  return Math.min(
    Math.max(Math.floor(beat / timeline.sampleStepBeats), 0),
    frameCount - 1,
  );
};
