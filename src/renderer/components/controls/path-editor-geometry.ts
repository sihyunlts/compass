import { PATH_COORDINATE_MAX, PATH_COORDINATE_MIN } from '../../../devices/path/schema';
import type { Bounds } from '../../../core/core-types';
import {
  evaluateCubicBezier,
  resolveAbsolutePathHandle,
  resolvePathBounds,
} from '../../../core/generators/path';
import { applyAffine, invertAffine } from '../../../core/geometry';
import { toPathAffine } from '../../../core/path-transform';
import type { PathAnchor, PathTransform } from '../../../shared/model';
import { clamp } from '../../../shared/math';
import { resolveSoftSnap } from './control-point-editor';
import type { EditorPoint, SnappedEditorPoint, AxisSnap } from './path-editor-types';

export const COORDINATE_RANGE = PATH_COORDINATE_MAX - PATH_COORDINATE_MIN;
export const EDITOR_CENTER = PATH_COORDINATE_MIN + COORDINATE_RANGE / 2;
export const PATH_TRANSFORM_SNAP_DISTANCE_PX = 4;
export const ROTATION_ZONE_SIZE_PERCENT = 8;
export const TRANSFORM_HANDLE_INSET_PERCENT = 3;
export const MIN_PATH_SCALE_SIZE_PX = 1;
const SNAP_VALUES = Array.from(
  { length: (COORDINATE_RANGE * 2) + 1 },
  (_, index) => PATH_COORDINATE_MIN + index * 0.5,
);
export const GRID_POSITIONS = Array.from(
  { length: COORDINATE_RANGE + 1 },
  (_, index) => PATH_COORDINATE_MIN + index,
);
export const SCALE_SNAP_VALUES = [...GRID_POSITIONS, EDITOR_CENTER];

export const roundCoordinate = (value: number): number => Number(value.toFixed(3));

export const toWorldPoint = (
  point: Readonly<EditorPoint>,
  pathTransform: Readonly<PathTransform>,
): EditorPoint => applyAffine(toPathAffine(pathTransform), point);

export const toLocalPoint = (
  point: Readonly<EditorPoint>,
  pathTransform: Readonly<PathTransform>,
): EditorPoint | null => {
  const inverse = invertAffine(toPathAffine(pathTransform));
  return inverse ? applyAffine(inverse, point) : null;
};

export const resolveSignedMinimumScale = (
  scale: number,
  minimumMagnitude: number,
): number => {
  if (Math.abs(scale) >= minimumMagnitude) {
    return scale;
  }
  return (scale < 0 ? -1 : 1) * minimumMagnitude;
};

export const resolveTransformedVectorLengthPx = (
  pathTransform: Readonly<PathTransform>,
  vector: Readonly<EditorPoint>,
  rect: DOMRect | undefined,
): number => {
  if (!rect) {
    return 0;
  }
  const affine = toPathAffine(pathTransform);
  const worldVector = {
    x: affine.a * vector.x + affine.b * vector.y,
    y: affine.c * vector.x + affine.d * vector.y,
  };
  return Math.hypot(
    worldVector.x * rect.width / COORDINATE_RANGE,
    worldVector.y * rect.height / COORDINATE_RANGE,
  );
};

export const resolveTransformAxisSnap = (
  value: number,
  targets: readonly number[],
  spanPx: number,
  enabled: boolean,
): AxisSnap => {
  if (!enabled || !Number.isFinite(spanPx) || spanPx <= 0) {
    return { value, target: null };
  }
  let nearestTarget: number | null = null;
  let nearestDistancePx = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const distancePx = Math.abs(value - target) * spanPx / COORDINATE_RANGE;
    if (
      distancePx <= PATH_TRANSFORM_SNAP_DISTANCE_PX
      && distancePx < nearestDistancePx
    ) {
      nearestTarget = target;
      nearestDistancePx = distancePx;
    }
  }
  return nearestTarget === null
    ? { value, target: null }
    : { value: nearestTarget, target: nearestTarget };
};

export const resolveTranslatedAxisSnap = (
  delta: number,
  sources: readonly number[],
  targets: readonly number[],
  spanPx: number,
  enabled: boolean,
): AxisSnap => {
  if (
    !enabled
    || sources.length === 0
    || targets.length === 0
    || !Number.isFinite(spanPx)
    || spanPx <= 0
  ) {
    return { value: delta, target: null };
  }
  let snappedDelta = delta;
  let nearestTarget: number | null = null;
  let nearestDistancePx = Number.POSITIVE_INFINITY;
  for (const source of sources) {
    const translated = source + delta;
    for (const target of targets) {
      const distancePx = Math.abs(translated - target) * spanPx / COORDINATE_RANGE;
      if (
        distancePx <= PATH_TRANSFORM_SNAP_DISTANCE_PX
        && distancePx < nearestDistancePx
      ) {
        snappedDelta = delta + target - translated;
        nearestTarget = target;
        nearestDistancePx = distancePx;
      }
    }
  }
  return { value: snappedDelta, target: nearestTarget };
};

export const resolveTranslationDelta = (
  startPoint: EditorPoint,
  point: EditorPoint,
  lockAxis: boolean,
): EditorPoint => {
  const delta = {
    x: point.x - startPoint.x,
    y: point.y - startPoint.y,
  };
  if (!lockAxis) {
    return delta;
  }
  return Math.abs(delta.x) >= Math.abs(delta.y)
    ? { x: delta.x, y: 0 }
    : { x: 0, y: delta.y };
};

export const resolveEditorPointFromClient = (
  rect: DOMRect | undefined,
  clientX: number,
  clientY: number,
  softSnap: boolean,
  constrainToEditor = true,
): SnappedEditorPoint | null => {
  if (!rect) {
    return null;
  }
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  const rawRatioX = (clientX - rect.left) / rect.width;
  const rawRatioY = (clientY - rect.top) / rect.height;
  const ratioX = constrainToEditor ? clamp(rawRatioX, 0, 1) : rawRatioX;
  const ratioY = constrainToEditor ? clamp(rawRatioY, 0, 1) : rawRatioY;
  const snappedX = resolveSoftSnap(
    PATH_COORDINATE_MIN + ratioX * COORDINATE_RANGE,
    softSnap ? SNAP_VALUES : [],
    rect.width / COORDINATE_RANGE,
  );
  const snappedY = resolveSoftSnap(
    PATH_COORDINATE_MAX - ratioY * COORDINATE_RANGE,
    softSnap ? SNAP_VALUES : [],
    rect.height / COORDINATE_RANGE,
  );
  return {
    point: { x: roundCoordinate(snappedX.value), y: roundCoordinate(snappedY.value) },
    snapSignature: [
      snappedX.target === null ? '' : `x:${snappedX.target}`,
      snappedY.target === null ? '' : `y:${snappedY.target}`,
    ].filter(Boolean).join('|') || null,
  };
};

export const toPlotPoint = (point: EditorPoint): EditorPoint => ({
  x: roundCoordinate(((point.x - PATH_COORDINATE_MIN) / COORDINATE_RANGE) * 100),
  y: roundCoordinate((1 - ((point.y - PATH_COORDINATE_MIN) / COORDINATE_RANGE)) * 100),
});

export const resolveWorldPathBounds = (
  pathAnchors: readonly PathAnchor[],
  pathClosed: boolean,
  pathTransform: Readonly<PathTransform>,
): Bounds | null => {
  const bounds = resolvePathBounds(pathAnchors, pathClosed);
  if (!bounds) {
    return null;
  }
  const points = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
  ].map((point) => toWorldPoint(point, pathTransform));
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
};

export const resolveNearestSegmentSample = (
  pathTransform: Readonly<PathTransform>,
  start: PathAnchor,
  end: PathAnchor,
  point: EditorPoint,
): { t: number; distanceSquared: number } => {
  const p0 = { x: start.x, y: start.y };
  const p1 = resolveAbsolutePathHandle(start, start.handleOut);
  const p2 = resolveAbsolutePathHandle(end, end.handleIn);
  const p3 = { x: end.x, y: end.y };
  const worldPoint = toWorldPoint(point, pathTransform);
  let nearestT = 0.5;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  for (let step = 1; step < 64; step += 1) {
    const t = step / 64;
    const candidate = evaluateCubicBezier(p0, p1, p2, p3, t);
    const worldCandidate = toWorldPoint(candidate, pathTransform);
    const distanceSquared = (worldCandidate.x - worldPoint.x) ** 2
      + (worldCandidate.y - worldPoint.y) ** 2;
    if (distanceSquared < nearestDistanceSquared) {
      nearestT = t;
      nearestDistanceSquared = distanceSquared;
    }
  }
  return { t: nearestT, distanceSquared: nearestDistanceSquared };
};

export const lerp = (start: EditorPoint, end: EditorPoint, t: number): EditorPoint => ({
  x: start.x + (end.x - start.x) * t,
  y: start.y + (end.y - start.y) * t,
});
