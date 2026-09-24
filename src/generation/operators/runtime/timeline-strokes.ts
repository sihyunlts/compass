import { iterateTimelineFrames } from '../../timeline';
import type { AffineTransform, Polyline } from '../../../core/core-types';
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
  resolvePolyline: typeof applyTransformToPolyline = applyTransformToPolyline,
): Omit<GeometryStroke, 'writeId'> => {
  const polyline = transform
    ? resolvePolyline(stroke.polyline, transform)
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

/** Transforms and source geometry are immutable snapshots scoped to one stage. */
export const createStrokeTransformer = (): typeof transformStroke => {
  interface TransformedGeometry {
    sourceTieDirection: Polyline['rasterTieBreakDirection'];
    geometry: Pick<Polyline, 'points' | 'rasterTieBreakDirection'>;
  }
  const geometryByTransform = new WeakMap<
    AffineTransform,
    WeakMap<Polyline['points'], TransformedGeometry>
  >();
  const resolvePolyline: typeof applyTransformToPolyline = (polyline, transform) => {
    let geometryByPoints = geometryByTransform.get(transform);
    if (!geometryByPoints) {
      geometryByPoints = new WeakMap();
      geometryByTransform.set(transform, geometryByPoints);
    }
    const cached = geometryByPoints.get(polyline.points);
    const tieDirection = polyline.rasterTieBreakDirection;
    if (cached
      && cached.sourceTieDirection?.x === tieDirection?.x
      && cached.sourceTieDirection?.y === tieDirection?.y) {
      return { ...polyline, ...cached.geometry };
    }
    const result = applyTransformToPolyline(polyline, transform);
    geometryByPoints.set(polyline.points, {
      sourceTieDirection: tieDirection,
      geometry: {
        points: result.points,
        ...(result.rasterTieBreakDirection ? { rasterTieBreakDirection: result.rasterTieBreakDirection } : {}),
      },
    });
    return result;
  };
  const masksByTransform = new WeakMap<AffineTransform, WeakMap<GeometryMask, GeometryMask>>();
  const resolveMask: typeof transformMask = (mask, transform) => {
    let masksBySource = masksByTransform.get(transform);
    if (!masksBySource) {
      masksBySource = new WeakMap();
      masksByTransform.set(transform, masksBySource);
    }
    let result = masksBySource.get(mask);
    if (!result) {
      result = transformMask(mask, transform);
      masksBySource.set(mask, result);
    }
    return result;
  };
  return (stroke, transform, writeOrder) => transformStroke(stroke, transform, writeOrder, resolveMask, resolvePolyline);
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
