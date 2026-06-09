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
  distanceSquared: number;
  colorSlotIndex?: number;
  colorSlotCount?: number;
}

interface CoordinateCollectionOptions {
  fillColorSlotGaps?: boolean;
}

const occupiedCoordinateCandidatesByStroke = new WeakMap<GeometryStroke, Array<{ x: number; y: number }>>();

const COLOR_SLOT_GAP_DIRECTIONS = Object.freeze([
  Object.freeze({ dx: 1, dy: 0 }),
  Object.freeze({ dx: 0, dy: 1 }),
  Object.freeze({ dx: 1, dy: 1 }),
  Object.freeze({ dx: 1, dy: -1 }),
]);

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
): boolean => {
  if (isRelatedColorSlotCandidate(candidate, current)) {
    const distanceDelta = resolveColorSlotBoundaryDistance(candidate) - resolveColorSlotBoundaryDistance(current);
    if (Math.abs(distanceDelta) > 1e-9) {
      return distanceDelta < 0;
    }
  }

  return candidate.writeOrder > current.writeOrder
    || (candidate.writeOrder === current.writeOrder && candidate.writeId > current.writeId);
};

const isRelatedColorSlotCandidate = (
  first: OccupiedCoordinate,
  second: OccupiedCoordinate,
): boolean => (
  first.originId === second.originId
  && first.originGroupId === second.originGroupId
  && typeof first.colorSlotIndex === 'number'
  && typeof second.colorSlotIndex === 'number'
  && typeof first.colorSlotCount === 'number'
  && typeof second.colorSlotCount === 'number'
  && first.colorSlotCount === second.colorSlotCount
);

const resolveColorSlotBoundaryDistance = (
  coordinate: OccupiedCoordinate,
): number => {
  const edgeSlotPenalty = coordinate.colorSlotIndex === 0 || coordinate.colorSlotIndex === coordinate.colorSlotCount - 1
    ? 0.04
    : 0;
  return coordinate.distanceSquared + edgeSlotPenalty;
};

const collectCenterlineCandidateCoordinates = (
  stroke: GeometryStroke,
): Array<{ x: number; y: number }> => {
  const points = stroke.polyline.points;
  if (points.length === 0) {
    return [];
  }

  const start = points[0];
  const end = points[points.length - 1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const coordinates = new Map<string, { x: number; y: number }>();

  const addCoordinate = (x: number, y: number): void => {
    const coordinateKey = toRoundedCoordinateKey(x, y);
    if (!coordinateKey) {
      return;
    }

    coordinates.set(coordinateKey, { x: Math.round(x), y: Math.round(y) });
  };

  if (Math.abs(dx) >= Math.abs(dy)) {
    const startX = Math.ceil(Math.min(start.x, end.x));
    const endX = Math.floor(Math.max(start.x, end.x));
    for (let x = startX; x <= endX; x += 1) {
      const t = dx === 0 ? 0 : (x - start.x) / dx;
      if (t < 0 || t > 1) {
        continue;
      }
      addCoordinate(x, start.y + t * dy);
    }
  } else {
    const startY = Math.ceil(Math.min(start.y, end.y));
    const endY = Math.floor(Math.max(start.y, end.y));
    for (let y = startY; y <= endY; y += 1) {
      const t = dy === 0 ? 0 : (y - start.y) / dy;
      if (t < 0 || t > 1) {
        continue;
      }
      addCoordinate(start.x + t * dx, y);
    }
  }

  addCoordinate(start.x, start.y);
  addCoordinate(end.x, end.y);
  return Array.from(coordinates.values());
};

const collectStrokeOccupiedCoordinates = (
  stroke: GeometryStroke,
): Array<{ x: number; y: number }> => {
  const cached = occupiedCoordinateCandidatesByStroke.get(stroke);
  if (cached) {
    return cached;
  }

  let coordinates: Array<{ x: number; y: number }>;
  if (stroke.polyline.rasterMode === 'centerline') {
    coordinates = collectCenterlineCandidateCoordinates(stroke);
  } else {
    const bounds = toCandidateBounds(stroke);
    if (!bounds) {
      coordinates = [];
    } else {
      coordinates = [];
      for (let y = bounds.startY; y <= bounds.endY; y += 1) {
        for (let x = bounds.startX; x <= bounds.endX; x += 1) {
          if (distanceToPolylineSquared({ x, y }, stroke.polyline) > THICKNESS * THICKNESS) {
            continue;
          }

          coordinates.push({ x, y });
        }
      }
    }
  }

  occupiedCoordinateCandidatesByStroke.set(stroke, coordinates);
  return coordinates;
};

const coordinateKeyAt = (
  x: number,
  y: number,
): string | null => toRoundedCoordinateKey(x, y);

const isAdjacentColorSlotGap = (
  first: OccupiedCoordinate,
  second: OccupiedCoordinate,
): boolean => (
  first.originId === second.originId
  && first.originGroupId === second.originGroupId
  && typeof first.colorSlotIndex === 'number'
  && typeof second.colorSlotIndex === 'number'
  && typeof first.colorSlotCount === 'number'
  && typeof second.colorSlotCount === 'number'
  && first.colorSlotCount === second.colorSlotCount
  && Math.abs(first.colorSlotIndex - second.colorSlotIndex) === 1
);

const toColorSlotGapFill = (
  x: number,
  y: number,
  first: OccupiedCoordinate,
  second: OccupiedCoordinate,
): OccupiedCoordinate => {
  const winner = shouldReplaceWinner(first, second) ? first : second;
  return {
    ...winner,
    x,
    y,
  };
};

const fillColorSlotGaps = (
  byCoordinate: Map<string, OccupiedCoordinate>,
): void => {
  if (byCoordinate.size === 0) {
    return;
  }

  const snapshot = new Map(byCoordinate);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const coordinate of snapshot.values()) {
    if (coordinate.x < minX) minX = coordinate.x;
    if (coordinate.x > maxX) maxX = coordinate.x;
    if (coordinate.y < minY) minY = coordinate.y;
    if (coordinate.y > maxY) maxY = coordinate.y;
  }

  const fills = new Map<string, OccupiedCoordinate>();
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const coordinateKey = coordinateKeyAt(x, y);
      if (!coordinateKey || snapshot.has(coordinateKey)) {
        continue;
      }

      for (const { dx, dy } of COLOR_SLOT_GAP_DIRECTIONS) {
        const firstKey = coordinateKeyAt(x - dx, y - dy);
        const secondKey = coordinateKeyAt(x + dx, y + dy);
        if (!firstKey || !secondKey) {
          continue;
        }

        const first = snapshot.get(firstKey);
        const second = snapshot.get(secondKey);
        if (!first || !second || !isAdjacentColorSlotGap(first, second)) {
          continue;
        }

        fills.set(coordinateKey, toColorSlotGapFill(x, y, first, second));
        break;
      }
    }
  }

  for (const [coordinateKey, fill] of fills.entries()) {
    byCoordinate.set(coordinateKey, fill);
  }
};

export const collectOccupiedCoordinates = (
  strokes: ReadonlyArray<GeometryStroke>,
  winnerOnly: boolean,
  options: CoordinateCollectionOptions = {},
): Map<string, OccupiedCoordinate> => {
  const byCoordinate = new Map<string, OccupiedCoordinate>();

  for (const stroke of strokes) {
    for (const { x, y } of collectStrokeOccupiedCoordinates(stroke)) {
      if (!isPointInsideMasks(stroke.masks, x, y)) {
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
        distanceSquared: distanceToPolylineSquared({ x, y }, stroke.polyline),
        colorSlotIndex: stroke.polyline.colorSlotIndex,
        colorSlotCount: stroke.polyline.colorSlotCount,
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

  if (winnerOnly && options.fillColorSlotGaps) {
    fillColorSlotGaps(byCoordinate);
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
