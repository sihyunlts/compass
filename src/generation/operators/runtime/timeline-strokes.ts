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
  resolveMask: typeof transformMask = transformMask,
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
    writeOrder,
    colorBinding: stroke.colorBinding,
    pathId: stroke.pathId,
    masks: transform
      ? stroke.masks.map((mask) => resolveMask(mask, transform))
      : stroke.masks,
  };
};

/** Reuse identical mask transforms within one geometry rewrite. */
export const createStrokeTransformer = (): typeof transformStroke => {
  const masksBySource = new Map<GeometryMask, Map<string, GeometryMask>>();
  const resolveMask: typeof transformMask = (mask, transform) => {
    const key = [transform.a, transform.b, transform.c, transform.d, transform.tx, transform.ty].join(',');
    let transformed = masksBySource.get(mask);
    if (!transformed) {
      transformed = new Map();
      masksBySource.set(mask, transformed);
    }
    let result = transformed.get(key);
    if (!result) {
      result = transformMask(mask, transform);
      transformed.set(key, result);
    }
    return result;
  };
  return (stroke, transform, writeOrder) => transformStroke(stroke, transform, writeOrder, resolveMask);
};

export const buildSourceStrokesByOriginAndFrame = (
  timeline: GeometryTimeline,
  targetOriginIds: ReadonlySet<string>,
): Map<string, Map<number, GeometryStroke[]>> => {
  const strokesByOriginId = new Map<string, Map<number, GeometryStroke[]>>();

  for (const { frameIndex, strokes } of iterateTimelineFrames(timeline, undefined, targetOriginIds)) {
    for (const stroke of strokes) {
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

/** Preserve copy lineage both before and after Color is materialized. */
export const copyStrokePath = <T extends Pick<GeometryStroke, 'pathId'>>(
  stroke: T,
  copyIndex: number,
): T => ({ ...stroke, pathId: `${stroke.pathId}/${copyIndex}` });
