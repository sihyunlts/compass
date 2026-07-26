import { THICKNESS } from '../../core/pipeline/constants';
import { applyAffine, distanceToPolylineSquared } from '../../core/geometry';
import { toRoundedCoordinateKey } from '../coordinates';
import type {
  GeometryMask,
  GeometryStroke,
} from '../types';

export interface OccupiedCoordinate {
  originId: string;
  originGroupId: string | null;
  x: number;
  y: number;
  velocity: number;
  writeOrder: number;
  writeId: number;
  distanceSquared: number;
  colorAgeBandIndex?: number;
  colorAgeBandCount?: number;
}

export interface StrokeOccupiedCoordinateCandidate {
  x: number;
  y: number;
  distanceSquared: number;
}

export interface OccupiedCoordinateCandidateBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const UNBOUNDED_COORDINATE_CANDIDATES: OccupiedCoordinateCandidateBounds = {
  minX: Number.NEGATIVE_INFINITY,
  maxX: Number.POSITIVE_INFINITY,
  minY: Number.NEGATIVE_INFINITY,
  maxY: Number.POSITIVE_INFINITY,
};

type OccupiedCoordinateCandidateCache = Map<string, StrokeOccupiedCoordinateCandidate[]>;

const occupiedCoordinateCandidatesByStroke = new WeakMap<GeometryStroke, OccupiedCoordinateCandidateCache>();
const occupiedCoordinateCandidatesByPoints = new WeakMap<GeometryStroke['polyline']['points'], OccupiedCoordinateCandidateCache>();
const TRAILING_COLOR_AGE_BAND_DISTANCE_BIAS_SQUARED = 0.04;

const toCandidateCacheKey = (
  bounds: OccupiedCoordinateCandidateBounds | null,
): string => bounds
  ? `${bounds.minX},${bounds.maxX},${bounds.minY},${bounds.maxY}`
  : 'all';

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
  outputBounds: OccupiedCoordinateCandidateBounds | null,
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

  const candidateBounds = outputBounds ?? UNBOUNDED_COORDINATE_CANDIDATES;
  const startX = Math.max(
    Math.floor(minX - THICKNESS),
    Math.ceil(candidateBounds.minX),
  );
  const endX = Math.min(
    Math.ceil(maxX + THICKNESS),
    Math.floor(candidateBounds.maxX),
  );
  const startY = Math.max(
    Math.floor(minY - THICKNESS),
    Math.ceil(candidateBounds.minY),
  );
  const endY = Math.min(
    Math.ceil(maxY + THICKNESS),
    Math.floor(candidateBounds.maxY),
  );
  return startX <= endX && startY <= endY
    ? { startX, endX, startY, endY }
    : null;
};

export const shouldReplaceOccupiedCoordinate = (
  candidate: OccupiedCoordinate,
  current: OccupiedCoordinate,
): boolean => {
  if (isRelatedColorAgeBand(candidate, current)) {
    if (Math.abs(candidate.writeOrder - current.writeOrder) > 1e-9) {
      return candidate.writeOrder > current.writeOrder;
    }

    const distanceDelta = resolveColorAgeBandBoundaryDistance(candidate)
      - resolveColorAgeBandBoundaryDistance(current);
    if (Math.abs(distanceDelta) > 1e-9) {
      return distanceDelta < 0;
    }
  }

  return candidate.writeOrder > current.writeOrder
    || (candidate.writeOrder === current.writeOrder && candidate.writeId > current.writeId);
};

const isRelatedColorAgeBand = (
  first: OccupiedCoordinate,
  second: OccupiedCoordinate,
): boolean => (
  first.originId === second.originId
  && first.originGroupId === second.originGroupId
  && typeof first.colorAgeBandIndex === 'number'
  && typeof second.colorAgeBandIndex === 'number'
  && typeof first.colorAgeBandCount === 'number'
  && typeof second.colorAgeBandCount === 'number'
  && first.colorAgeBandCount === second.colorAgeBandCount
);

const resolveColorAgeBandBoundaryDistance = (
  coordinate: OccupiedCoordinate,
): number => {
  // The final band has only a preceding neighbor, so keep near-boundary raster
  // overlap with that neighbor instead of letting the final band swallow it.
  const trailingBandBias = coordinate.colorAgeBandIndex === coordinate.colorAgeBandCount - 1
    ? TRAILING_COLOR_AGE_BAND_DISTANCE_BIAS_SQUARED
    : 0;
  return coordinate.distanceSquared + trailingBandBias;
};

export const createOccupiedCoordinate = (
  stroke: GeometryStroke,
  x: number,
  y: number,
  distanceSquared: number,
): OccupiedCoordinate => ({
  originId: stroke.polyline.originId,
  originGroupId: stroke.originGroupId,
  x,
  y,
  velocity: stroke.polyline.velocity,
  writeOrder: stroke.writeOrder,
  writeId: stroke.writeId,
  distanceSquared,
  colorAgeBandIndex: stroke.polyline.colorAgeBandIndex,
  colorAgeBandCount: stroke.polyline.colorAgeBandCount,
});

const collectCenterlineCandidateCoordinates = (
  stroke: GeometryStroke,
  outputBounds: OccupiedCoordinateCandidateBounds | null,
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

    const roundedX = Math.round(x);
    const roundedY = Math.round(y);
    if (
      outputBounds
      && (
        roundedX < outputBounds.minX
        || roundedX > outputBounds.maxX
        || roundedY < outputBounds.minY
        || roundedY > outputBounds.maxY
      )
    ) {
      return;
    }

    coordinates.set(coordinateKey, { x: roundedX, y: roundedY });
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

const resolveStrokeOccupiedCoordinateCandidates = (
  stroke: GeometryStroke,
  outputBounds: OccupiedCoordinateCandidateBounds | null,
): StrokeOccupiedCoordinateCandidate[] => {
  const cacheKey = toCandidateCacheKey(outputBounds);
  const cached = occupiedCoordinateCandidatesByStroke.get(stroke)?.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (stroke.masks.length === 0) {
    const pointsCached = occupiedCoordinateCandidatesByPoints
      .get(stroke.polyline.points)
      ?.get(cacheKey);
    if (pointsCached) {
      const strokeCache = occupiedCoordinateCandidatesByStroke.get(stroke) ?? new Map();
      strokeCache.set(cacheKey, pointsCached);
      occupiedCoordinateCandidatesByStroke.set(stroke, strokeCache);
      return pointsCached;
    }
  }

  let coordinates: StrokeOccupiedCoordinateCandidate[];
  if (stroke.polyline.rasterMode === 'centerline') {
    coordinates = toOccupiedCoordinateCandidates(
      stroke,
      collectCenterlineCandidateCoordinates(stroke, outputBounds),
    );
  } else {
    const bounds = toCandidateBounds(stroke, outputBounds);
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

  const strokeCache = occupiedCoordinateCandidatesByStroke.get(stroke) ?? new Map();
  strokeCache.set(cacheKey, coordinates);
  occupiedCoordinateCandidatesByStroke.set(stroke, strokeCache);
  if (stroke.masks.length === 0) {
    const pointsCache = occupiedCoordinateCandidatesByPoints.get(stroke.polyline.points) ?? new Map();
    pointsCache.set(cacheKey, coordinates);
    occupiedCoordinateCandidatesByPoints.set(stroke.polyline.points, pointsCache);
  }
  return coordinates;
};

export const collectStrokeOccupiedCoordinateCandidates = (
  stroke: GeometryStroke,
  outputBounds: OccupiedCoordinateCandidateBounds | null = null,
): StrokeOccupiedCoordinateCandidate[] => resolveStrokeOccupiedCoordinateCandidates(
  stroke,
  outputBounds,
).filter(({ x, y }) => isPointInsideMasks(stroke.masks, x, y));

export const collectOccupiedCoordinates = (
  strokes: ReadonlyArray<GeometryStroke>,
  winnerOnly: boolean,
  outputBounds: OccupiedCoordinateCandidateBounds | null = null,
): Map<string, OccupiedCoordinate> => {
  const byCoordinate = new Map<string, OccupiedCoordinate>();

  for (const stroke of strokes) {
    for (const {
      x,
      y,
      distanceSquared,
    } of collectStrokeOccupiedCoordinateCandidates(stroke, outputBounds)) {
      const coordinateKey = toRoundedCoordinateKey(x, y);
      if (!coordinateKey) {
        continue;
      }

      const candidate = createOccupiedCoordinate(
        stroke,
        Math.round(x),
        Math.round(y),
        distanceSquared,
      );

      if (!winnerOnly) {
        byCoordinate.set(`${stroke.writeId}:${coordinateKey}`, candidate);
        continue;
      }

      const existing = byCoordinate.get(coordinateKey);
      if (!existing || shouldReplaceOccupiedCoordinate(candidate, existing)) {
        byCoordinate.set(coordinateKey, candidate);
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
