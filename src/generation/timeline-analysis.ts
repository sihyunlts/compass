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
  colorSlotGapFill?: boolean;
}

interface StrokeOccupiedCoordinateCandidate {
  x: number;
  y: number;
  distanceSquared: number;
}

interface CoordinateCollectionOptions {
  fillColorSlotGaps?: boolean;
}

const occupiedCoordinateCandidatesByStroke = new WeakMap<GeometryStroke, StrokeOccupiedCoordinateCandidate[]>();
const occupiedCoordinateCandidatesByPoints = new WeakMap<GeometryStroke['polyline']['points'], StrokeOccupiedCoordinateCandidate[]>();
const geometryKeyByPoints = new WeakMap<GeometryStroke['polyline']['points'], string>();
const occupiedCoordinateCandidatesByGeometryKey = new Map<string, StrokeOccupiedCoordinateCandidate[]>();

const COLOR_SLOT_GAP_DIRECTIONS = Object.freeze([
  Object.freeze({ dx: 1, dy: 0 }),
  Object.freeze({ dx: 0, dy: 1 }),
  Object.freeze({ dx: 1, dy: 1 }),
  Object.freeze({ dx: 1, dy: -1 }),
]);
const INTERIOR_COLOR_SLOT_GAP_MIN_NEIGHBORS = 7;
const COLOR_SLOT_GAP_SUPPORT_OFFSETS = Object.freeze([
  Object.freeze({ dx: -1, dy: -1 }),
  Object.freeze({ dx: 0, dy: -1 }),
  Object.freeze({ dx: 1, dy: -1 }),
  Object.freeze({ dx: -1, dy: 0 }),
  Object.freeze({ dx: 1, dy: 0 }),
  Object.freeze({ dx: -1, dy: 1 }),
  Object.freeze({ dx: 0, dy: 1 }),
  Object.freeze({ dx: 1, dy: 1 }),
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
    if (Math.abs(candidate.writeOrder - current.writeOrder) > 1e-9) {
      return candidate.writeOrder > current.writeOrder;
    }

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

const toOccupiedCoordinateCandidates = (
  stroke: GeometryStroke,
  coordinates: ReadonlyArray<{ x: number; y: number }>,
): StrokeOccupiedCoordinateCandidate[] => coordinates.map((coordinate) => ({
  x: coordinate.x,
  y: coordinate.y,
  distanceSquared: distanceToPolylineSquared(coordinate, stroke.polyline),
}));

const resolvePolylineGeometryKey = (
  stroke: GeometryStroke,
): string => {
  const cached = geometryKeyByPoints.get(stroke.polyline.points);
  if (cached) {
    return cached;
  }

  const key = [
    stroke.polyline.closed ? 'closed' : 'open',
    stroke.polyline.rasterMode ?? 'default',
    ...stroke.polyline.points.map((point) => `${point.x},${point.y}`),
  ].join('|');
  geometryKeyByPoints.set(stroke.polyline.points, key);
  return key;
};

const collectStrokeOccupiedCoordinates = (
  stroke: GeometryStroke,
): StrokeOccupiedCoordinateCandidate[] => {
  const cached = occupiedCoordinateCandidatesByStroke.get(stroke);
  if (cached) {
    return cached;
  }

  const activationSignature = stroke.masks.length === 0
    ? stroke.polyline.activationSignature
    : undefined;
  if (activationSignature) {
    const geometryKey = `${activationSignature}\n${resolvePolylineGeometryKey(stroke)}`;
    const geometryCached = occupiedCoordinateCandidatesByGeometryKey.get(geometryKey);
    if (geometryCached) {
      occupiedCoordinateCandidatesByStroke.set(stroke, geometryCached);
      occupiedCoordinateCandidatesByPoints.set(stroke.polyline.points, geometryCached);
      return geometryCached;
    }
  }

  if (stroke.masks.length === 0) {
    const pointsCached = occupiedCoordinateCandidatesByPoints.get(stroke.polyline.points);
    if (pointsCached) {
      occupiedCoordinateCandidatesByStroke.set(stroke, pointsCached);
      return pointsCached;
    }
  }

  let coordinates: StrokeOccupiedCoordinateCandidate[];
  if (stroke.polyline.rasterMode === 'centerline') {
    coordinates = toOccupiedCoordinateCandidates(
      stroke,
      collectCenterlineCandidateCoordinates(stroke),
    );
  } else {
    const bounds = toCandidateBounds(stroke);
    if (!bounds) {
      coordinates = [];
    } else {
      coordinates = [];
      for (let y = bounds.startY; y <= bounds.endY; y += 1) {
        for (let x = bounds.startX; x <= bounds.endX; x += 1) {
          const distanceSquared = distanceToPolylineSquared({ x, y }, stroke.polyline);
          if (distanceSquared > THICKNESS * THICKNESS) {
            continue;
          }

          coordinates.push({ x, y, distanceSquared });
        }
      }
    }
  }

  occupiedCoordinateCandidatesByStroke.set(stroke, coordinates);
  if (stroke.masks.length === 0) {
    occupiedCoordinateCandidatesByPoints.set(stroke.polyline.points, coordinates);
    if (activationSignature) {
      occupiedCoordinateCandidatesByGeometryKey.set(
        `${activationSignature}\n${resolvePolylineGeometryKey(stroke)}`,
        coordinates,
      );
    }
  }
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

const countOccupiedNeighbors = (
  snapshot: ReadonlyMap<string, OccupiedCoordinate>,
  x: number,
  y: number,
): number => {
  let count = 0;
  for (const { dx, dy } of COLOR_SLOT_GAP_SUPPORT_OFFSETS) {
    const coordinateKey = coordinateKeyAt(x + dx, y + dy);
    if (coordinateKey && snapshot.has(coordinateKey)) {
      count += 1;
    }
  }
  return count;
};

const canFillColorSlotGap = (
  snapshot: ReadonlyMap<string, OccupiedCoordinate>,
  x: number,
  y: number,
  first: OccupiedCoordinate,
  second: OccupiedCoordinate,
): boolean => {
  if (!isAdjacentColorSlotGap(first, second)) {
    return false;
  }

  if (first.colorSlotGapFill === true && second.colorSlotGapFill === true) {
    return true;
  }

  return countOccupiedNeighbors(snapshot, x, y) >= INTERIOR_COLOR_SLOT_GAP_MIN_NEIGHBORS;
};

const toColorSlotGapFill = (
  x: number,
  y: number,
  first: OccupiedCoordinate,
  second: OccupiedCoordinate,
): OccupiedCoordinate => {
  const distanceDelta = resolveColorSlotBoundaryDistance(first) - resolveColorSlotBoundaryDistance(second);
  const winner = Math.abs(distanceDelta) > 1e-9
    ? (distanceDelta < 0 ? first : second)
    : (shouldReplaceWinner(first, second) ? first : second);
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
        if (!first || !second || !canFillColorSlotGap(snapshot, x, y, first, second)) {
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
    for (const { x, y, distanceSquared } of collectStrokeOccupiedCoordinates(stroke)) {
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
        distanceSquared,
        colorSlotIndex: stroke.polyline.colorSlotIndex,
        colorSlotCount: stroke.polyline.colorSlotCount,
        colorSlotGapFill: stroke.polyline.colorSlotGapFill,
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
