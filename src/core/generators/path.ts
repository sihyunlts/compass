import type { Polyline, Vec2 } from '../core-types';
import { applyAffine, IDENTITY_AFFINE } from '../geometry';
import type {
  PathAnchor,
  PathHandle,
  PathParams,
  PathTransform,
} from '../../shared/model';

const PATH_FLATTEN_MAX_ERROR = 0.025;
const PATH_FLATTEN_MAX_SEGMENT_LENGTH = 0.25;
const PATH_FLATTEN_MAX_RECURSION_DEPTH = 12;

interface FlattenedPathGeometry {
  points: ReadonlyArray<Readonly<Vec2>>;
  cumulativeLengths: ReadonlyArray<number>;
  anchorPointIndices: ReadonlyArray<number>;
  totalLength: number;
}

const geometryCache = new WeakMap<
  readonly PathAnchor[],
  Map<string, FlattenedPathGeometry>
>();

const distance = (a: Readonly<Vec2>, b: Readonly<Vec2>): number =>
  Math.hypot(b.x - a.x, b.y - a.y);

const midpoint = (a: Readonly<Vec2>, b: Readonly<Vec2>): Vec2 => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

const distanceToLine = (
  point: Readonly<Vec2>,
  start: Readonly<Vec2>,
  end: Readonly<Vec2>,
): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= Number.EPSILON) {
    return distance(point, start);
  }
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x)
    / length;
};

export const evaluateCubicBezier = (
  start: Readonly<Vec2>,
  control1: Readonly<Vec2>,
  control2: Readonly<Vec2>,
  end: Readonly<Vec2>,
  t: number,
): Vec2 => {
  const clampedT = Math.min(Math.max(t, 0), 1);
  const inverse = 1 - clampedT;
  const inverse2 = inverse * inverse;
  const t2 = clampedT * clampedT;
  return {
    x: inverse2 * inverse * start.x
      + 3 * inverse2 * clampedT * control1.x
      + 3 * inverse * t2 * control2.x
      + t2 * clampedT * end.x,
    y: inverse2 * inverse * start.y
      + 3 * inverse2 * clampedT * control1.y
      + 3 * inverse * t2 * control2.y
      + t2 * clampedT * end.y,
  };
};

export const resolveAbsolutePathHandle = (
  anchor: Readonly<PathAnchor>,
  handle: Readonly<PathHandle> | undefined,
): Vec2 => handle
  ? { x: anchor.x + handle.x, y: anchor.y + handle.y }
  : { x: anchor.x, y: anchor.y };

export const collectPathControlPoints = (
  anchors: readonly PathAnchor[],
  transform: Readonly<PathTransform> = IDENTITY_AFFINE,
): Vec2[] => anchors.flatMap((anchor) => [
  applyAffine(transform, anchor),
  ...(anchor.handleIn
    ? [applyAffine(transform, resolveAbsolutePathHandle(anchor, anchor.handleIn))]
    : []),
  ...(anchor.handleOut
    ? [applyAffine(transform, resolveAbsolutePathHandle(anchor, anchor.handleOut))]
    : []),
]);

const flattenCubic = (
  start: Readonly<Vec2>,
  control1: Readonly<Vec2>,
  control2: Readonly<Vec2>,
  end: Readonly<Vec2>,
  depth: number,
  output: Vec2[],
): void => {
  const flatness = Math.max(
    distanceToLine(control1, start, end),
    distanceToLine(control2, start, end),
  );
  const controlPolygonLength = distance(start, control1)
    + distance(control1, control2)
    + distance(control2, end);
  if (
    depth >= PATH_FLATTEN_MAX_RECURSION_DEPTH
    || (flatness <= PATH_FLATTEN_MAX_ERROR
      && controlPolygonLength <= PATH_FLATTEN_MAX_SEGMENT_LENGTH)
  ) {
    output.push({ x: end.x, y: end.y });
    return;
  }

  const startControlMid = midpoint(start, control1);
  const controlsMid = midpoint(control1, control2);
  const controlEndMid = midpoint(control2, end);
  const leftControl = midpoint(startControlMid, controlsMid);
  const rightControl = midpoint(controlsMid, controlEndMid);
  const split = midpoint(leftControl, rightControl);
  flattenCubic(start, startControlMid, leftControl, split, depth + 1, output);
  flattenCubic(split, rightControl, controlEndMid, end, depth + 1, output);
};

const buildFlattenedPathGeometry = (
  anchors: readonly PathAnchor[],
  closed: boolean,
  transform: Readonly<PathTransform>,
): FlattenedPathGeometry => {
  if (anchors.length < 2) {
    return {
      points: [],
      cumulativeLengths: [],
      anchorPointIndices: [],
      totalLength: 0,
    };
  }

  const points: Vec2[] = [applyAffine(transform, anchors[0])];
  const anchorPointIndices = Array.from({ length: anchors.length }, () => 0);
  const segmentCount = closed ? anchors.length : anchors.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = anchors[index];
    const end = anchors[(index + 1) % anchors.length];
    flattenCubic(
      applyAffine(transform, start),
      applyAffine(transform, resolveAbsolutePathHandle(start, start.handleOut)),
      applyAffine(transform, resolveAbsolutePathHandle(end, end.handleIn)),
      applyAffine(transform, end),
      0,
      points,
    );
    const endAnchorIndex = (index + 1) % anchors.length;
    if (endAnchorIndex !== 0) {
      anchorPointIndices[endAnchorIndex] = points.length - 1;
    }
  }

  const cumulativeLengths = [0];
  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    totalLength += distance(points[index - 1], points[index]);
    cumulativeLengths.push(totalLength);
  }
  return { points, cumulativeLengths, anchorPointIndices, totalLength };
};

const flattenPathGeometry = (
  anchors: readonly PathAnchor[],
  closed: boolean,
  transform: Readonly<PathTransform>,
): FlattenedPathGeometry => {
  let cached = geometryCache.get(anchors);
  if (!cached) {
    cached = new Map();
    geometryCache.set(anchors, cached);
  }
  const key = `${closed ? 'closed' : 'open'}:${transform.a}:${transform.b}:${transform.c}:${transform.d}:${transform.tx}:${transform.ty}`;
  const existing = cached.get(key);
  if (existing) {
    return existing;
  }
  const geometry = buildFlattenedPathGeometry(anchors, closed, transform);
  cached.set(key, geometry);
  return geometry;
};

const samplePathAtProgress = (
  geometry: FlattenedPathGeometry,
  progress01: number,
): Vec2 | null => {
  if (geometry.points.length === 0) {
    return null;
  }
  if (geometry.points.length === 1 || geometry.totalLength <= Number.EPSILON) {
    return { ...geometry.points[0] };
  }

  const targetLength = Math.min(Math.max(progress01, 0), 1) * geometry.totalLength;
  let low = 1;
  let high = geometry.cumulativeLengths.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (geometry.cumulativeLengths[middle] < targetLength) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const endIndex = low;
  const startIndex = endIndex - 1;
  const segmentStartLength = geometry.cumulativeLengths[startIndex];
  const segmentLength = geometry.cumulativeLengths[endIndex] - segmentStartLength;
  const localProgress = segmentLength <= Number.EPSILON
    ? 0
    : (targetLength - segmentStartLength) / segmentLength;
  const start = geometry.points[startIndex];
  const end = geometry.points[endIndex];
  return {
    x: start.x + (end.x - start.x) * localProgress,
    y: start.y + (end.y - start.y) * localProgress,
  };
};

const wrapProgress = (value: number): number => {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
};

export const sampleAnimatedPathAtProgress = (
  anchors: readonly PathAnchor[],
  closed: boolean,
  startAnchorId: string,
  direction: PathParams['animation']['direction'],
  progress01: number,
  transform: Readonly<PathTransform> = IDENTITY_AFFINE,
): Vec2 | null => {
  const geometry = flattenPathGeometry(anchors, closed, transform);
  const clampedProgress = Math.min(Math.max(progress01, 0), 1);
  if (!closed) {
    return samplePathAtProgress(
      geometry,
      direction === 'reverse' ? 1 - clampedProgress : clampedProgress,
    );
  }

  const startAnchorIndex = Math.max(
    anchors.findIndex((anchor) => anchor.id === startAnchorId),
    0,
  );
  const startPointIndex = geometry.anchorPointIndices[startAnchorIndex] ?? 0;
  const startProgress = geometry.totalLength <= Number.EPSILON
    ? 0
    : geometry.cumulativeLengths[startPointIndex] / geometry.totalLength;
  const directedProgress = direction === 'reverse' ? -clampedProgress : clampedProgress;
  return samplePathAtProgress(geometry, wrapProgress(startProgress + directedProgress));
};

export const buildPathPolyline = (
  originId: string,
  params: PathParams,
  progress01: number,
  velocity: number,
): Polyline | null => {
  if (params.anchors.length < 2) {
    return null;
  }

  const geometry = flattenPathGeometry(params.anchors, params.closed, params.transform);
  if (params.animation.enabled) {
    const point = sampleAnimatedPathAtProgress(
      params.anchors,
      params.closed,
      params.animation.startAnchorId,
      params.animation.direction,
      progress01,
      params.transform,
    );
    if (!point) {
      return null;
    }
    return {
      points: [point],
      closed: false,
      originId,
      velocity,
      rasterMode: 'centerline',
    };
  }

  return {
    points: geometry.points,
    closed: params.closed,
    originId,
    velocity,
    ...(params.fill ? { rasterMode: 'fill' as const } : {}),
  };
};
