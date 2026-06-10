import { clamp } from '../../shared/math';
import type {
  CurveNode,
  ModulationCurve,
} from '../../shared/model';
import {
  canSegmentCurveBendAffectShape,
  roundCurveNumber,
  toSegmentCurvePoint,
  type CurvePoint,
} from '../curve-segments';
export {
  buildCurveSegments,
  evaluateCurveSegments,
  evaluateNormalizedCurveAt,
  toSegmentCurveBend,
} from '../curve-segments';
export type { CurvePoint, CurveSegment } from '../curve-segments';

const MIN_CURVE_DIVISIONS = 2;
const MAX_CURVE_DIVISIONS = 64;
const DEFAULT_CURVE_DIVISIONS = 16;
const CURVE_ROUNDING_DIGITS = 6;
const CURVE_ZERO_EPSILON = 1e-6;
const DEFAULT_CURVE_NODES: ReadonlyArray<CurveNode> = Object.freeze([
  { id: 'curve-node-start', t: 0, v: 0 },
  { id: 'curve-node-end', t: 1, v: 0 },
]);

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

export const toLoopProgress01 = (
  beat: number,
  loopLengthBeats: number,
  wrap = true,
): number => {
  const safeLoopLength = Number.isFinite(loopLengthBeats) && loopLengthBeats > 0
    ? loopLengthBeats
    : 1;
  const normalized = Number.isFinite(beat) ? beat / safeLoopLength : 0;
  if (!wrap) {
    return clamp(normalized, 0, 1);
  }
  return ((normalized % 1) + 1) % 1;
};
