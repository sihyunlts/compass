import type { Bounds, Polyline, Vec2 } from '../core-types';
import { THICKNESS } from '../pipeline/constants';
import type { RainParams } from '../../shared/model';
import { toAxisBasis } from '../geometry';

const RAIN_EXIT_CLEARANCE = 0.01;
const RAIN_FIELD_PADDING = THICKNESS + RAIN_EXIT_CLEARANCE;
const RAIN_EMISSION_JITTER_MAX = 0.45;
const RAIN_EMISSION_SEED_SALT = 0x9e3779b1;
const RAIN_LANE_SEED_SALT = 0x85ebca77;
const RAIN_PERP_SEQUENCE_STEP = 0.6180339887498949;
const RAIN_REFERENCE_TRAVEL_DURATION_BEATS = 0.25;
const RAIN_TIMELINE_END_BEAT = 1;
const AXIS_COMPONENT_EPSILON = 1e-9;
const UINT32_RANGE = 0x1_0000_0000;

type AxisInterval = {
  min: number;
  max: number;
};

const expandRainFieldBounds = (
  bounds: Bounds,
): Bounds => ({
  minX: bounds.minX - RAIN_FIELD_PADDING,
  maxX: bounds.maxX + RAIN_FIELD_PADDING,
  minY: bounds.minY - RAIN_FIELD_PADDING,
  maxY: bounds.maxY + RAIN_FIELD_PADDING,
});

const projectOnAxis = (
  point: Vec2,
  axis: Vec2,
): number => point.x * axis.x + point.y * axis.y;

const positiveModulo = (
  value: number,
  divisor: number,
): number => {
  const remainder = value % divisor;
  return remainder < 0 ? remainder + divisor : remainder;
};

const mixUint32 = (
  value: number,
): number => {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
};

const seededRandom01 = (
  seed: number,
  sampleIndex: number,
  salt: number,
): number => {
  const indexHash = Math.imul((sampleIndex + 1) >>> 0, salt);
  return mixUint32((seed ^ indexHash) >>> 0) / UINT32_RANGE;
};

const resolvePerpendicularBounds = (
  bounds: Bounds,
  perp: Vec2,
): AxisInterval | null => {
  const corners = [
    {
      x: bounds.minX,
      y: bounds.minY,
    },
    {
      x: bounds.minX,
      y: bounds.maxY,
    },
    {
      x: bounds.maxX,
      y: bounds.minY,
    },
    {
      x: bounds.maxX,
      y: bounds.maxY,
    },
  ];

  let minPerp = Number.POSITIVE_INFINITY;
  let maxPerp = Number.NEGATIVE_INFINITY;

  for (const corner of corners) {
    const projectedPerp = projectOnAxis(corner, perp);
    if (projectedPerp < minPerp) minPerp = projectedPerp;
    if (projectedPerp > maxPerp) maxPerp = projectedPerp;
  }

  if (
    !Number.isFinite(minPerp)
    || !Number.isFinite(maxPerp)
  ) {
    return null;
  }

  return {
    min: minPerp,
    max: maxPerp,
  };
};

const resolveCoordinateAxisInterval = (
  minCoordinate: number,
  maxCoordinate: number,
  axisComponent: number,
  perpComponent: number,
  perpPosition: number,
): AxisInterval | null => {
  const fixedCoordinate = perpComponent * perpPosition;
  if (Math.abs(axisComponent) <= AXIS_COMPONENT_EPSILON) {
    return fixedCoordinate >= minCoordinate - AXIS_COMPONENT_EPSILON
      && fixedCoordinate <= maxCoordinate + AXIS_COMPONENT_EPSILON
      ? {
        min: Number.NEGATIVE_INFINITY,
        max: Number.POSITIVE_INFINITY,
      }
      : null;
  }

  const first = (minCoordinate - fixedCoordinate) / axisComponent;
  const second = (maxCoordinate - fixedCoordinate) / axisComponent;
  return {
    min: Math.min(first, second),
    max: Math.max(first, second),
  };
};

const resolveLaneAxisBounds = (
  bounds: Bounds,
  axis: Vec2,
  perp: Vec2,
  perpPosition: number,
): AxisInterval | null => {
  const xInterval = resolveCoordinateAxisInterval(
    bounds.minX,
    bounds.maxX,
    axis.x,
    perp.x,
    perpPosition,
  );
  const yInterval = resolveCoordinateAxisInterval(
    bounds.minY,
    bounds.maxY,
    axis.y,
    perp.y,
    perpPosition,
  );
  if (!xInterval || !yInterval) {
    return null;
  }

  const min = Math.max(xInterval.min, yInterval.min);
  const max = Math.min(xInterval.max, yInterval.max);
  return Number.isFinite(min)
    && Number.isFinite(max)
    && max > min
    ? { min, max }
    : null;
};

export const buildRainPolylines = (
  originId: string,
  params: RainParams,
  beat01: number,
  sampleStepBeats: number,
  velocity: number,
  bounds: Bounds,
): Polyline[] => {
  if (
    !Number.isFinite(params.seed)
    || !Number.isFinite(params.angleDeg)
    || !Number.isFinite(params.density)
    || !Number.isFinite(params.speed)
    || !Number.isFinite(beat01)
    || !Number.isFinite(sampleStepBeats)
    || params.density <= 0
    || params.speed <= 0
    || sampleStepBeats <= 0
  ) {
    return [];
  }

  if (beat01 >= RAIN_TIMELINE_END_BEAT - sampleStepBeats) {
    return [];
  }

  const basis = toAxisBasis(params.angleDeg);
  if (
    !Number.isFinite(basis.axisX)
    || !Number.isFinite(basis.axisY)
    || !Number.isFinite(basis.perpX)
    || !Number.isFinite(basis.perpY)
  ) {
    return [];
  }

  const axis = { x: basis.axisX, y: basis.axisY };
  const perp = { x: basis.perpX, y: basis.perpY };
  const fieldBounds = expandRainFieldBounds(bounds);
  const perpendicularBounds = resolvePerpendicularBounds(fieldBounds, perp);
  if (!perpendicularBounds) {
    return [];
  }

  const perpSpan = perpendicularBounds.max - perpendicularBounds.min;
  if (
    !Number.isFinite(perpSpan)
    || perpSpan <= 0
  ) {
    return [];
  }

  const particleCount = Math.max(Math.round(params.density), 0);
  if (particleCount === 0) {
    return [];
  }

  const fieldWidth = (
    fieldBounds.maxX
    - fieldBounds.minX
  );
  const fieldHeight = (
    fieldBounds.maxY
    - fieldBounds.minY
  );
  const referenceTravelDistance = Math.max(fieldWidth, fieldHeight);
  const travelSpeed = (
    referenceTravelDistance
    / RAIN_REFERENCE_TRAVEL_DURATION_BEATS
    * params.speed
  );
  const averageLaneAxisSpan = (fieldWidth * fieldHeight) / perpSpan;
  const maxLaneAxisSpan = Math.min(
    Math.abs(axis.x) > AXIS_COMPONENT_EPSILON
      ? fieldWidth / Math.abs(axis.x)
      : Number.POSITIVE_INFINITY,
    Math.abs(axis.y) > AXIS_COMPONENT_EPSILON
      ? fieldHeight / Math.abs(axis.y)
      : Number.POSITIVE_INFINITY,
  );
  if (
    !Number.isFinite(travelSpeed)
    || travelSpeed <= 0
    || !Number.isFinite(averageLaneAxisSpan)
    || averageLaneAxisSpan <= 0
    || !Number.isFinite(maxLaneAxisSpan)
    || maxLaneAxisSpan <= 0
  ) {
    return [];
  }

  const seed = Math.trunc(params.seed) >>> 0;
  const averageTravelDurationBeats = averageLaneAxisSpan / travelSpeed;
  const maxTravelDurationBeats = maxLaneAxisSpan / travelSpeed;
  const emissionIntervalBeats = averageTravelDurationBeats / particleCount;
  const perpRotation = seededRandom01(seed, 0, RAIN_LANE_SEED_SALT);
  const polylines: Polyline[] = [];
  const firstBirthIndex = Math.max(
    Math.floor(
      (beat01 - maxTravelDurationBeats) / emissionIntervalBeats,
    ) - 1,
    0,
  );
  const lastBirthIndex = Math.floor(
    beat01 / emissionIntervalBeats,
  );

  for (
    let birthIndex = firstBirthIndex;
    birthIndex <= lastBirthIndex;
    birthIndex += 1
  ) {
    const emissionJitter = birthIndex === 0
      ? 0
      : (
        seededRandom01(seed, birthIndex, RAIN_EMISSION_SEED_SALT)
        * RAIN_EMISSION_JITTER_MAX
      );
    const birthBeat = (
      (birthIndex + emissionJitter) * emissionIntervalBeats
    );
    const perpFraction = positiveModulo(
      perpRotation + birthIndex * RAIN_PERP_SEQUENCE_STEP,
      1,
    );
    const perpPosition = perpendicularBounds.min + perpFraction * perpSpan;
    const laneAxisBounds = resolveLaneAxisBounds(
      fieldBounds,
      axis,
      perp,
      perpPosition,
    );
    if (!laneAxisBounds) {
      continue;
    }
    const laneAxisSpan = laneAxisBounds.max - laneAxisBounds.min;
    const travelDurationBeats = laneAxisSpan / travelSpeed;
    const emissionEndBeat = (
      RAIN_TIMELINE_END_BEAT
      - travelDurationBeats
      - sampleStepBeats
    );
    if (birthBeat > emissionEndBeat) {
      continue;
    }

    const ageBeats = beat01 - birthBeat;
    const previousAgeBeats = ageBeats - sampleStepBeats;
    if (
      ageBeats < 0
      || previousAgeBeats >= travelDurationBeats
    ) {
      continue;
    }

    const currentAxisPosition = (
      laneAxisBounds.min
      + (
        Math.min(ageBeats, travelDurationBeats)
        / travelDurationBeats
      ) * laneAxisSpan
    );
    const currentPoint = {
      x: axis.x * currentAxisPosition + perp.x * perpPosition,
      y: axis.y * currentAxisPosition + perp.y * perpPosition,
    };

    polylines.push({
      points: [currentPoint],
      closed: false,
      originId,
      velocity,
      rasterMode: 'centerline',
      clipStack: [],
    });
  }

  return polylines;
};
