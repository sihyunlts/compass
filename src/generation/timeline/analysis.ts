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
  ColorLayer,
  GeometryMask,
  GeometryStroke,
} from '../types';

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

const occupiedCoordinateCandidatesByPoints = new WeakMap<GeometryStroke['polyline']['points'], OccupiedCoordinateCandidateCache>();
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

const compareLayerOrder = (left: ReadonlyArray<number>, right: ReadonlyArray<number>): number => {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
};

interface RankedCoordinate {
  stroke: GeometryStroke;
  distanceRank: number;
}

const colorSamplesByStroke = new WeakMap<GeometryStroke, Map<number, RankedCoordinate>>();

interface CoordinatePath {
  latest: RankedCoordinate;
  samplesByEnd: Map<number, RankedCoordinate>;
}

interface CoordinateTopLayer {
  writeOrder: number;
  plainWinner?: RankedCoordinate;
  layer?: ColorLayer;
  samples: RankedCoordinate[];
}

const compareSampleOrder = (left: GeometryStroke, right: GeometryStroke): number => {
  const frameOrder = left.colorBinding!.sourceFrame - right.colorBinding!.sourceFrame;
  if (frameOrder !== 0) return frameOrder;
  // Copy identity survives transformations on either side of Color.
  if (left.pathId !== right.pathId) return left.pathId > right.pathId ? 1 : -1;
  return left.colorBinding!.sourceOrder - right.colorBinding!.sourceOrder;
};

const isNearerSample = (left: RankedCoordinate, right: RankedCoordinate): boolean =>
  left.distanceRank < right.distanceRank
  || (left.distanceRank === right.distanceRank
    && compareSampleOrder(left.stroke, right.stroke) > 0);

const resolveLatestPassage = (path: CoordinatePath): RankedCoordinate => {
  let sample: RankedCoordinate | undefined = path.latest;
  let winner = sample;
  // Adjacent source poses touching this LED form one passage. A missing pose
  // separates a later return from old history, including self-intersections.
  while (sample) {
    if (isNearerSample(sample, winner)) winner = sample;
    sample = path.samplesByEnd.get(sample.stroke.colorBinding!.sourceFrame);
  }
  return winner;
};

/** Select the visible layer before resolving its paths and color history. */
export class CoordinateColorResolver<TKey> {
  private readonly coordinates = new Map<TKey, CoordinateTopLayer>();

  add(key: TKey, stroke: GeometryStroke, distanceSquared: number): void {
    let coordinate = this.coordinates.get(key);
    if (coordinate && coordinate.writeOrder > stroke.writeOrder) return;
    if (!coordinate || coordinate.writeOrder < stroke.writeOrder) {
      coordinate = { writeOrder: stroke.writeOrder, samples: [] };
      this.coordinates.set(key, coordinate);
    }

    const binding = stroke.colorBinding;
    if (binding && binding.layer !== coordinate.layer) {
      const layerOrder = coordinate.layer ? compareLayerOrder(binding.layer.order, coordinate.layer.order) : 1;
      if (layerOrder <= 0) return;
      coordinate.layer = binding.layer;
      coordinate.samples.length = 0;
    }
    // A held stroke has the same rank at this LED in every frame.
    let samples = colorSamplesByStroke.get(stroke);
    if (!samples) {
      samples = new Map();
      colorSamplesByStroke.set(stroke, samples);
    }
    let candidate = samples.get(distanceSquared);
    if (!candidate) {
      candidate = { stroke, distanceRank: Math.round(distanceSquared / 1e-9) };
      samples.set(distanceSquared, candidate);
    }
    if (!binding) {
      if (!coordinate.plainWinner || stroke.writeId > coordinate.plainWinner.stroke.writeId) {
        coordinate.plainWinner = candidate;
      }
      return;
    }

    coordinate.samples.push(candidate);
  }

  get(key: TKey): RankedCoordinate | undefined {
    const coordinate = this.coordinates.get(key);
    if (!coordinate) return undefined;
    if (!coordinate.layer || (coordinate.plainWinner
      && compareLayerOrder(coordinate.layer.order, [coordinate.plainWinner.stroke.writeId]) <= 0)) {
      return coordinate.plainWinner;
    }

    // Build passage histories only for the layer that survives every overlap.
    const paths = new Map<string, CoordinatePath>();
    for (const candidate of coordinate.samples) {
      const { stroke } = candidate;
      const binding = stroke.colorBinding!;
      let path = paths.get(stroke.pathId);
      if (!path) {
        path = { latest: candidate, samplesByEnd: new Map() };
        paths.set(stroke.pathId, path);
      }
      const previous = path.samplesByEnd.get(binding.sourceEndFrameExclusive);
      if (previous && !isNearerSample(candidate, previous)) continue;
      path.samplesByEnd.set(binding.sourceEndFrameExclusive, candidate);
      if (binding.sourceFrame >= path.latest.stroke.colorBinding!.sourceFrame) path.latest = candidate;
    }
    let winner: RankedCoordinate | undefined;
    for (const path of paths.values()) {
      const candidate = resolveLatestPassage(path);
      if (!winner || compareSampleOrder(candidate.stroke, winner.stroke) > 0) {
        winner = candidate;
      }
    }
    return winner;
  }

  *entries(): Generator<[TKey, RankedCoordinate]> {
    for (const key of this.coordinates.keys()) yield [key, this.get(key)!];
  }
}

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
  // These candidates precede mask filtering, so masked strokes share geometry too.
  const cached = occupiedCoordinateCandidatesByPoints.get(stroke.polyline.points)?.get(cacheKey);
  if (cached) return cached;

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

  const pointsCache = occupiedCoordinateCandidatesByPoints.get(stroke.polyline.points) ?? new Map();
  pointsCache.set(cacheKey, coordinates);
  occupiedCoordinateCandidatesByPoints.set(stroke.polyline.points, pointsCache);
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
