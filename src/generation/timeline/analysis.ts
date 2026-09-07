import { THICKNESS } from '../../core/pipeline/constants';
import {
  applyAffine,
  distanceToPolylineSquared,
  distanceToRasterizedPolylineSquared,
} from '../../core/geometry';
import {
  coordinatePredicateContainsPoint,
  toRoundedCoordinateKey,
} from '../coordinates';
import type {
  GeometryMask,
  GeometryStroke,
} from '../types';

export interface OccupiedCoordinate {
  stroke: GeometryStroke;
  x: number;
  y: number;
  distanceSquared: number;
}

interface StrokeOccupiedCoordinateCandidate {
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

type OccupiedCoordinateCandidateCache = Map<string, StrokeOccupiedCoordinateCandidate[]>;

const occupiedCoordinateCandidatesByStroke = new WeakMap<GeometryStroke, OccupiedCoordinateCandidateCache>();
const occupiedCoordinateCandidatesByPoints = new WeakMap<GeometryStroke['polyline']['points'], OccupiedCoordinateCandidateCache>();
const TRAILING_COLOR_AGE_BAND_DISTANCE_BIAS_SQUARED = 0.04;
const RASTER_TIE_EPSILON = 1e-9;

const roundRasterCoordinate = (
  value: number,
  primaryTieDirection: number,
  secondaryTieDirection: number,
): number => {
  const lower = Math.floor(value);
  if (Math.abs(value - (lower + 0.5)) > RASTER_TIE_EPSILON) {
    return Math.round(value);
  }

  const direction = Math.abs(primaryTieDirection) > RASTER_TIE_EPSILON
    ? primaryTieDirection
    : secondaryTieDirection;
  return direction < 0 ? lower : lower + 1;
};

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

  if (!outputBounds) return null;
  const candidateBounds = outputBounds;
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

const shouldReplaceOccupiedCoordinate = (
  candidate: GeometryStroke,
  candidateDistanceSquared: number,
  current: OccupiedCoordinate,
): boolean => {
  if (isRelatedColorAgeBand(candidate, current.stroke)) {
    if (Math.abs(candidate.writeOrder - current.stroke.writeOrder) > 1e-9) {
      return candidate.writeOrder > current.stroke.writeOrder;
    }

    const distanceDelta = resolveColorAgeBandBoundaryDistance(candidate, candidateDistanceSquared)
      - resolveColorAgeBandBoundaryDistance(current.stroke, current.distanceSquared);
    if (Math.abs(distanceDelta) > 1e-9) {
      return distanceDelta < 0;
    }
  }

  return candidate.writeOrder > current.stroke.writeOrder
    || (candidate.writeOrder === current.stroke.writeOrder && candidate.writeId > current.stroke.writeId);
};

const isRelatedColorAgeBand = (
  first: GeometryStroke,
  second: GeometryStroke,
): boolean => (
  first.polyline.originId === second.polyline.originId
  && first.originGroupId === second.originGroupId
  && typeof first.polyline.colorAgeBandIndex === 'number'
  && typeof second.polyline.colorAgeBandIndex === 'number'
  && typeof first.polyline.colorAgeBandCount === 'number'
  && typeof second.polyline.colorAgeBandCount === 'number'
  && first.polyline.colorAgeBandCount === second.polyline.colorAgeBandCount
);

const resolveColorAgeBandBoundaryDistance = (
  stroke: GeometryStroke,
  distanceSquared: number,
): number => {
  // The final band has only a preceding neighbor, so keep near-boundary raster
  // overlap with that neighbor instead of letting the final band swallow it.
  const trailingBandBias = stroke.polyline.colorAgeBandIndex === stroke.polyline.colorAgeBandCount - 1
    ? TRAILING_COLOR_AGE_BAND_DISTANCE_BIAS_SQUARED
    : 0;
  return distanceSquared + trailingBandBias;
};

const createOccupiedCoordinate = (
  stroke: GeometryStroke,
  x: number,
  y: number,
  distanceSquared: number,
): OccupiedCoordinate => ({
  stroke,
  x,
  y,
  distanceSquared,
});

export const writeOccupiedCoordinateWinner = <TKey>(
  winners: Map<TKey, OccupiedCoordinate>,
  key: TKey,
  stroke: GeometryStroke,
  x: number,
  y: number,
  distanceSquared: number,
): void => {
  const current = winners.get(key);
  if (!current) {
    winners.set(key, createOccupiedCoordinate(stroke, x, y, distanceSquared));
  } else if (shouldReplaceOccupiedCoordinate(stroke, distanceSquared, current)) {
    // This record belongs to one coordinate in the current projection only.
    current.stroke = stroke;
    current.distanceSquared = distanceSquared;
  }
};

const collectCenterlineCandidateCoordinates = (
  stroke: GeometryStroke,
  outputBounds: OccupiedCoordinateCandidateBounds | null,
): Array<{ x: number; y: number }> => {
  const points = stroke.polyline.points;
  if (points.length === 0 || !outputBounds) {
    return [];
  }

  const coordinates = new Map<string, { x: number; y: number }>();

  const addCoordinate = (
    x: number,
    y: number,
    tieBreakDirection?: Readonly<{ x: number; y: number }>,
  ): void => {
    const roundedX = tieBreakDirection
      ? roundRasterCoordinate(x, tieBreakDirection.x, tieBreakDirection.y)
      : Math.round(x);
    const roundedY = tieBreakDirection
      ? roundRasterCoordinate(y, tieBreakDirection.y, tieBreakDirection.x)
      : Math.round(y);
    const coordinateKey = toRoundedCoordinateKey(roundedX, roundedY);
    if (!coordinateKey) {
      return;
    }

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

  const addSegmentCoordinates = (
    start: GeometryStroke['polyline']['points'][number],
    end: GeometryStroke['polyline']['points'][number],
  ): void => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) {
      addCoordinate(start.x, start.y, stroke.polyline.rasterTieBreakDirection);
      return;
    }
    const isLine = stroke.polyline.extent === 'line';
    if (Math.abs(dx) >= Math.abs(dy)) {
      const startX = Math.ceil(Math.max(isLine ? -Infinity : Math.min(start.x, end.x), outputBounds.minX));
      const endX = Math.floor(Math.min(isLine ? Infinity : Math.max(start.x, end.x), outputBounds.maxX));
      for (let x = startX; x <= endX; x += 1) {
        const t = dx === 0 ? 0 : (x - start.x) / dx;
        if (!isLine && (t < 0 || t > 1)) {
          continue;
        }
        addCoordinate(x, start.y + t * dy);
      }
    } else {
      const startY = Math.ceil(Math.max(isLine ? -Infinity : Math.min(start.y, end.y), outputBounds.minY));
      const endY = Math.floor(Math.min(isLine ? Infinity : Math.max(start.y, end.y), outputBounds.maxY));
      for (let y = startY; y <= endY; y += 1) {
        const t = dy === 0 ? 0 : (y - start.y) / dy;
        if (!isLine && (t < 0 || t > 1)) {
          continue;
        }
        addCoordinate(start.x + t * dx, y);
      }
    }
    if (!isLine) {
      addCoordinate(start.x, start.y);
      addCoordinate(end.x, end.y);
    }
  };

  for (let index = 0; index < points.length - 1; index += 1) {
    addSegmentCoordinates(points[index], points[index + 1]);
  }
  if (stroke.polyline.closed && points.length > 1) {
    addSegmentCoordinates(points[points.length - 1], points[0]);
  } else if (points.length === 1) {
    addCoordinate(
      points[0].x,
      points[0].y,
      stroke.polyline.rasterTieBreakDirection,
    );
  }
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
  const cacheKey = [
    toCandidateCacheKey(outputBounds),
    stroke.polyline.closed ? 'closed' : 'open',
    stroke.polyline.extent ?? 'bounded',
    stroke.polyline.rasterMode ?? 'stroke',
    stroke.polyline.rasterTieBreakDirection?.x ?? 'no-tie-x',
    stroke.polyline.rasterTieBreakDirection?.y ?? 'no-tie-y',
  ].join(':');
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
          const rasterDistanceSquared = distanceToRasterizedPolylineSquared(
            { x, y },
            stroke.polyline,
          );
          if (rasterDistanceSquared > THICKNESS * THICKNESS) {
            continue;
          }

          coordinates.push({ x, y, distanceSquared: rasterDistanceSquared });
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
  outputBounds: OccupiedCoordinateCandidateBounds | null,
): StrokeOccupiedCoordinateCandidate[] => resolveStrokeOccupiedCoordinateCandidates(
  stroke,
  outputBounds,
).filter(({ x, y }) => isPointInsideMasks(stroke.masks, x, y));

export const createGeometryCoordinateMask = (
  strokes: ReadonlyArray<GeometryStroke>,
): ((x: number, y: number) => boolean) => (x, y) => coordinatePredicateContainsPoint(
  (candidateX, candidateY) => strokes.some((stroke) => isPointInsideMasks(stroke.masks, candidateX, candidateY)
    && (stroke.polyline.rasterMode === 'centerline'
      ? collectCenterlineCandidateCoordinates(stroke, {
          minX: candidateX, maxX: candidateX, minY: candidateY, maxY: candidateY,
        }).length > 0
      : distanceToRasterizedPolylineSquared({ x: candidateX, y: candidateY }, stroke.polyline)
        <= THICKNESS * THICKNESS)),
  x,
  y,
);
