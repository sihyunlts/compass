import { clamp } from '../../shared/math';
import type {
  CurveNode,
  ModulationCurve,
} from '../../shared/model';

const MIN_CURVE_DIVISIONS = 2;
const MAX_CURVE_DIVISIONS = 64;
const DEFAULT_CURVE_DIVISIONS = 16;
const CURVE_ROUNDING_DIGITS = 6;
const CURVE_ZERO_EPSILON = 1e-6;
const MAX_CURVE_POWER = 24;
const DEFAULT_CURVE_NODES: ReadonlyArray<CurveNode> = Object.freeze([
  { id: 'curve-node-start', t: 0, v: 0 },
  { id: 'curve-node-end', t: 1, v: 0 },
]);

export interface CurvePoint {
  t: number;
  v: number;
}

export interface CurveSegment {
  start: CurvePoint;
  end: CurvePoint;
  bend: number;
}

const roundCurveNumber = (value: number): number =>
  Number(value.toFixed(CURVE_ROUNDING_DIGITS));

const toNodeSortValue = (node: CurveNode): number =>
  Number.isFinite(node.t) ? node.t : 0;

const sortNodes = (nodes: CurveNode[]): CurveNode[] =>
  [...nodes].sort((a, b) => toNodeSortValue(a) - toNodeSortValue(b));

export const sanitizeCurveDivisions = (value: unknown): number => {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) {
    return DEFAULT_CURVE_DIVISIONS;
  }
  return clamp(numeric, MIN_CURVE_DIVISIONS, MAX_CURVE_DIVISIONS);
};

const sanitizeNodeId = (value: unknown, fallbackIndex: number): string => {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return `curve-node-${fallbackIndex + 1}`;
};

const getDefaultSegmentPoint = (
  startNode: CurveNode,
  endNode: CurveNode,
): CurvePoint => ({
  t: (startNode.t + endNode.t) * 0.5,
  v: (startNode.v + endNode.v) * 0.5,
});

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

const sanitizeRawCurveBend = (value: unknown): number | undefined => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return roundCurveNumber(clamp(numeric, -1, 1));
};

const normalizeCurveNode = (rawNode: unknown, index: number): CurveNode | null => {
  if (!rawNode || typeof rawNode !== 'object') {
    return null;
  }

  const t = clamp(Number((rawNode as { t?: unknown }).t), 0, 1);
  const v = clamp(Number((rawNode as { v?: unknown }).v), -1, 1);
  if (!Number.isFinite(t) || !Number.isFinite(v)) {
    return null;
  }

  const nextCurveBend = sanitizeRawCurveBend(
    (rawNode as { nextCurveBend?: unknown }).nextCurveBend,
  );
  return {
    id: sanitizeNodeId((rawNode as { id?: unknown }).id, index),
    t: roundCurveNumber(t),
    v: roundCurveNumber(v),
    ...(typeof nextCurveBend === 'number' ? { nextCurveBend } : {}),
  };
};

const canonicalizeCurveBend = (
  bend: number | undefined,
  startNode: CurveNode,
  endNode: CurveNode | undefined,
): number | undefined => {
  if (typeof bend !== 'number' || !endNode) {
    return undefined;
  }

  if (!canSegmentCurveBendAffectShape(startNode, endNode)) {
    return undefined;
  }

  const normalized = roundCurveNumber(clamp(bend, -1, 1));
  return Math.abs(normalized) <= CURVE_ZERO_EPSILON ? undefined : normalized;
};

export const sanitizeCurveNodes = (rawNodes: unknown): CurveNode[] => {
  if (!Array.isArray(rawNodes)) {
    return [...DEFAULT_CURVE_NODES];
  }

  const normalized = rawNodes
    .map((rawNode, index) => normalizeCurveNode(rawNode, index))
    .filter((node): node is CurveNode => node !== null);

  const dedupedBySnap = new Map<string, CurveNode>();
  for (const node of sortNodes(normalized)) {
    dedupedBySnap.set(node.t.toFixed(CURVE_ROUNDING_DIGITS), node);
  }

  const sanitized = [...dedupedBySnap.values()];
  if (sanitized.length < 2) {
    return [...DEFAULT_CURVE_NODES];
  }

  return sanitized.map((node, index, nodes) => {
    const endNode = nodes[index + 1];
    const nextCurveBend = canonicalizeCurveBend(
      node.nextCurveBend ?? undefined,
      node,
      endNode,
    );
    return {
      id: node.id,
      t: node.t,
      v: node.v,
      ...(typeof nextCurveBend === 'number' ? { nextCurveBend } : {}),
    };
  });
};

export const sanitizeModulationCurve = (raw: unknown): ModulationCurve => {
  const source = raw && typeof raw === 'object' ? raw as Partial<ModulationCurve> : null;
  return {
    domain: 'loop01',
    divisions: sanitizeCurveDivisions(source?.divisions),
    nodes: sanitizeCurveNodes(source?.nodes),
  };
};

export const resolveSegmentCurvePoint = (
  nodes: ReadonlyArray<CurveNode>,
  index: number,
): {
  point: CurvePoint | null;
  isStub: boolean;
} => {
  const startNode = nodes[index];
  const endNode = nodes[index + 1];
  if (!startNode || !endNode) {
    return { point: null, isStub: false };
  }

  if (!canSegmentCurveBendAffectShape(startNode, endNode)) {
    return { point: null, isStub: false };
  }

  if (typeof startNode.nextCurveBend !== 'number') {
    return {
      point: getDefaultSegmentPoint(startNode, endNode),
      isStub: true,
    };
  }

  return {
    point: toSegmentCurvePoint(startNode, endNode, startNode.nextCurveBend),
    isStub: false,
  };
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

export const toLoopProgress01 = (
  beat01: number,
  loopLengthBeats: number,
  wrap = true,
): number => {
  const safeLoopLength = Number.isFinite(loopLengthBeats) && loopLengthBeats > 0
    ? loopLengthBeats
    : 1;
  const normalized = Number.isFinite(beat01) ? beat01 : 0;
  if (!wrap) {
    return clamp(normalized, 0, 1);
  }
  const beatInLoop = normalized * safeLoopLength;
  return ((beatInLoop / safeLoopLength) % 1 + 1) % 1;
};
