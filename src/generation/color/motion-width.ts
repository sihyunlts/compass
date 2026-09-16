import type { Polyline, Vec2 } from '../../core/core-types';
import { IDENTITY_AFFINE } from '../../core/geometry';
import type { GeometryStateEvent } from '../geometry/event-track';
import type { GeometryMask } from '../types';

interface Segment {
  start: Vec2;
  dx: number;
  dy: number;
  length: number;
  offset: number;
}

interface PathShape {
  polyline: Polyline;
  segments: Segment[];
  length: number;
}

const createPathShape = (polyline: Polyline): PathShape => {
  const segments: Segment[] = [];
  let length = 0;
  const count = polyline.closed ? polyline.points.length : polyline.points.length - 1;
  for (let index = 0; index < count; index += 1) {
    const start = polyline.points[index];
    const end = polyline.points[(index + 1) % polyline.points.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const segmentLength = Math.hypot(dx, dy);
    segments.push({ start, dx, dy, length: segmentLength, offset: length });
    length += segmentLength;
  }
  return { polyline, segments, length };
};

const pointOnSegment = (segment: Segment, position: number): Vec2 => ({
  x: segment.start.x + position * segment.dx,
  y: segment.start.y + position * segment.dy,
});

const pointAtFraction = (shape: PathShape, fraction: number): Vec2 => {
  if (shape.length < 1e-9) return shape.polyline.points[0];
  const distance = fraction * shape.length;
  const segment = shape.segments.find((entry) => entry.offset + entry.length >= distance)
    ?? shape.segments[shape.segments.length - 1];
  return pointOnSegment(segment, segment.length > 1e-9
    ? (distance - segment.offset) / segment.length
    : 0);
};

const closestPathPoint = (
  shape: PathShape,
  x: number,
  y: number,
): { point: Vec2; fraction: number } | null => {
  if (shape.polyline.points.length === 0) return null;
  if (shape.length < 1e-9) return { point: shape.polyline.points[0], fraction: 0 };
  let closest: { point: Vec2; fraction: number } | null = null;
  let closestDistance = Infinity;
  for (const segment of shape.segments) {
    if (segment.length < 1e-9) continue;
    let position = ((x - segment.start.x) * segment.dx + (y - segment.start.y) * segment.dy)
      / (segment.length * segment.length);
    if (shape.polyline.extent !== 'line') position = Math.max(0, Math.min(1, position));
    const point = pointOnSegment(segment, position);
    const distance = (x - point.x) ** 2 + (y - point.y) ** 2;
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = { point, fraction: (segment.offset + position * segment.length) / shape.length };
    }
  }
  return closest;
};

const createMotionWidthMask = (
  before: PathShape,
  current: PathShape,
  after: PathShape,
  widthRatio: number,
): GeometryMask => ({
  inverseTransform: IDENTITY_AFFINE,
  contains: (x, y) => {
    const nearest = closestPathPoint(current, x, y);
    if (!nearest) return false;
    const start = pointAtFraction(before, nearest.fraction);
    const end = pointAtFraction(after, nearest.fraction);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const speed = Math.hypot(dx, dy);
    // A stationary part has no motion axis along which to shorten its footprint.
    if (speed < 1e-7) return true;
    const distanceAlongMotion = Math.abs((x - nearest.point.x) * dx + (y - nearest.point.y) * dy);
    // Centerline rasterization selects square cells; strokes use a circular radius.
    const projectedWidth = current.polyline.rasterMode === 'centerline'
      ? Math.abs(dx) + Math.abs(dy)
      : speed;
    return distanceAlongMotion <= widthRatio * projectedWidth / 2;
  },
});

/** Restrict the source footprint in its local motion direction, before Color adds history. */
export const applyMotionWidth = (
  events: ReadonlyArray<GeometryStateEvent>,
  widthRatio: number,
): ReadonlyArray<GeometryStateEvent> => {
  if (widthRatio >= 1) return events;
  const shapesByEvent = events.map((event) => event.strokes.map((stroke) => ({
    stroke,
    shape: createPathShape(stroke.polyline),
  })));
  const pathsByEvent = shapesByEvent.map((entries) => new Map(entries.map(({ stroke, shape }) => (
    [stroke.pathId, shape] as const
  ))));
  return events.map((event, index) => ({
    ...event,
    strokes: shapesByEvent[index].map(({ stroke, shape: current }) => {
      // At a path lifetime boundary use a one-sided derivative of that same path.
      const beforeShape = pathsByEvent[Math.max(0, index - 1)].get(stroke.pathId);
      const afterShape = pathsByEvent[Math.min(events.length - 1, index + 1)].get(stroke.pathId);
      const before = beforeShape && beforeShape.polyline.points.length > 0
        ? beforeShape
        : current;
      const after = afterShape && afterShape.polyline.points.length > 0
        ? afterShape
        : current;
      return {
        ...stroke,
        masks: [...stroke.masks, createMotionWidthMask(before, current, after, widthRatio)],
      };
    }),
  }));
};
