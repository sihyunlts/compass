import { THICKNESS } from '../core/pipeline/constants';
import { applyAffine, distanceToPolylineSquared } from '../core/geometry';
import { toRoundedCoordinateKey } from './coordinates';
import type {
  GeometryMask,
  GeometryStroke,
} from './types';

interface OccupiedCoordinate {
  originId: string;
  originGroupId: string | null;
  x: number;
  y: number;
  velocity: number;
  writeOrder: number;
  writeId: number;
}

const isPointInsideMasks = (
  masks: ReadonlyArray<GeometryMask>,
  x: number,
  y: number,
): boolean => masks.every((mask) => {
  const localPoint = applyAffine(mask.inverseTransform, { x, y });
  return mask.contains(localPoint.x, localPoint.y);
});

const toCandidateBounds = (
  stroke: GeometryStroke,
): {
  startX: number;
  endX: number;
  startY: number;
  endY: number;
} | null => {
  if (stroke.polyline.points.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of stroke.polyline.points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return null;
  }

  return {
    startX: Math.floor(minX - THICKNESS),
    endX: Math.ceil(maxX + THICKNESS),
    startY: Math.floor(minY - THICKNESS),
    endY: Math.ceil(maxY + THICKNESS),
  };
};

const shouldReplaceWinner = (
  candidate: OccupiedCoordinate,
  current: OccupiedCoordinate,
): boolean => (
  candidate.writeOrder > current.writeOrder
  || (candidate.writeOrder === current.writeOrder && candidate.writeId > current.writeId)
);

export const collectOccupiedCoordinates = (
  strokes: ReadonlyArray<GeometryStroke>,
  winnerOnly: boolean,
): Map<string, OccupiedCoordinate> => {
  const byCoordinate = new Map<string, OccupiedCoordinate>();

  for (const stroke of strokes) {
    const bounds = toCandidateBounds(stroke);
    if (!bounds) {
      continue;
    }

    for (let y = bounds.startY; y <= bounds.endY; y += 1) {
      for (let x = bounds.startX; x <= bounds.endX; x += 1) {
        if (!isPointInsideMasks(stroke.masks, x, y)) {
          continue;
        }
        if (distanceToPolylineSquared({ x, y }, stroke.polyline) > THICKNESS * THICKNESS) {
          continue;
        }

        const coordinateKey = toRoundedCoordinateKey(x, y);
        if (!coordinateKey) {
          continue;
        }

        const candidate: OccupiedCoordinate = {
          originId: stroke.polyline.originId,
          originGroupId: stroke.originGroupId,
          x: Math.round(x),
          y: Math.round(y),
          velocity: stroke.polyline.velocity,
          writeOrder: stroke.writeOrder,
          writeId: stroke.writeId,
        };

        if (!winnerOnly) {
          byCoordinate.set(`${stroke.writeId}:${coordinateKey}`, candidate);
          continue;
        }

        const existing = byCoordinate.get(coordinateKey);
        if (!existing || shouldReplaceWinner(candidate, existing)) {
          byCoordinate.set(coordinateKey, candidate);
        }
      }
    }
  }

  return byCoordinate;
};

export const createCoordinateMask = (
  coordinates: ReadonlyMap<string, OccupiedCoordinate>,
): ((x: number, y: number) => boolean) => {
  const roundedKeys = new Set<string>();
  for (const coordinate of coordinates.values()) {
    roundedKeys.add(`${coordinate.x},${coordinate.y}`);
  }

  return (x, y) => {
    const coordinateKey = toRoundedCoordinateKey(x, y);
    return coordinateKey !== null && roundedKeys.has(coordinateKey);
  };
};
