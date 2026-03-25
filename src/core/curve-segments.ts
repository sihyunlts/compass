import { clamp } from '../shared/math';
import type { CurveNode } from '../shared/model';

const CURVE_ROUNDING_DIGITS = 6;
const CURVE_ZERO_EPSILON = 1e-6;
const MAX_CURVE_POWER = 24;

export interface CurvePoint {
  t: number;
  v: number;
}

export interface CurveSegment {
  start: CurvePoint;
  end: CurvePoint;
  bend: number;
}

export const roundCurveNumber = (value: number): number =>
  Number(value.toFixed(CURVE_ROUNDING_DIGITS));

const toCurvePower = (bend: number): number =>
  1 + Math.abs(clamp(bend, -1, 1)) * (MAX_CURVE_POWER - 1);

const lerp = (start: number, end: number, amount: number): number =>
  start + (end - start) * amount;

export const evaluateNormalizedCurveAt = (
  progress01: number,
  bend: number,
): number => {
  const progress = clamp(progress01, 0, 1);
  const normalizedBend = clamp(bend, -1, 1);
  if (Math.abs(normalizedBend) <= CURVE_ZERO_EPSILON) {
    return progress;
  }

  const power = toCurvePower(normalizedBend);
  if (normalizedBend < 0) {
    return progress ** power;
  }

  return 1 - ((1 - progress) ** power);
};

export const canSegmentCurveBendAffectShape = (
  startNode: CurveNode,
  endNode: CurveNode,
): boolean =>
  Math.abs(endNode.t - startNode.t) > CURVE_ZERO_EPSILON
  && Math.abs(endNode.v - startNode.v) > CURVE_ZERO_EPSILON;

const getDefaultSegmentPoint = (
  startNode: CurveNode,
  endNode: CurveNode,
): CurvePoint => ({
  t: (startNode.t + endNode.t) * 0.5,
  v: (startNode.v + endNode.v) * 0.5,
});

export const toSegmentCurvePoint = (
  startNode: CurveNode,
  endNode: CurveNode,
  bend: number,
): CurvePoint => {
  const midpoint = getDefaultSegmentPoint(startNode, endNode);
  const curveProgress = evaluateNormalizedCurveAt(0.5, bend);
  return {
    t: midpoint.t,
    v: lerp(startNode.v, endNode.v, curveProgress),
  };
};

export const toSegmentCurveBend = (
  startNode: CurveNode,
  endNode: CurveNode,
  point: CurvePoint,
): number => {
  if (!canSegmentCurveBendAffectShape(startNode, endNode)) {
    return 0;
  }

  const span = endNode.v - startNode.v;
  const progress = clamp((point.v - startNode.v) / span, 0, 1);
  if (progress <= CURVE_ZERO_EPSILON) {
    return -1;
  }
  if (progress >= 1 - CURVE_ZERO_EPSILON) {
    return 1;
  }
  if (Math.abs(progress - 0.5) <= CURVE_ZERO_EPSILON) {
    return 0;
  }

  if (progress < 0.5) {
    const power = Math.log(progress) / Math.log(0.5);
    const bend = -((power - 1) / (MAX_CURVE_POWER - 1));
    return roundCurveNumber(clamp(bend, -1, 0));
  }

  const power = Math.log(1 - progress) / Math.log(0.5);
  const bend = (power - 1) / (MAX_CURVE_POWER - 1);
  return roundCurveNumber(clamp(bend, 0, 1));
};

export const buildCurveSegments = (
  nodes: ReadonlyArray<CurveNode>,
): CurveSegment[] => {
  if (nodes.length < 2) {
    return [];
  }

  const segments: CurveSegment[] = [];
  for (let index = 1; index < nodes.length; index += 1) {
    const startNode = nodes[index - 1];
    const endNode = nodes[index];
    const bend = typeof startNode.nextCurveBend === 'number'
      ? startNode.nextCurveBend
      : 0;

    segments.push({
      start: { t: startNode.t, v: startNode.v },
      end: { t: endNode.t, v: endNode.v },
      bend,
    });
  }

  return segments;
};

export const evaluateCurveSegments = (
  segments: ReadonlyArray<CurveSegment>,
  t01: number,
): number => {
  if (segments.length === 0) {
    return 0;
  }

  const t = clamp(Number.isFinite(t01) ? t01 : 0, 0, 1);
  const firstSegment = segments[0];
  if (t <= firstSegment.start.t) {
    return firstSegment.start.v;
  }

  const lastSegment = segments[segments.length - 1];
  if (t >= lastSegment.end.t) {
    return lastSegment.end.v;
  }

  const segment = segments.find((candidate) => t <= candidate.end.t) ?? lastSegment;
  const span = Math.max(segment.end.t - segment.start.t, CURVE_ZERO_EPSILON);
  const ratio = (t - segment.start.t) / span;
  const curveProgress = evaluateNormalizedCurveAt(ratio, segment.bend);
  return lerp(segment.start.v, segment.end.v, curveProgress);
};
