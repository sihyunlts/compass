import { clamp } from '../../shared/math';
import type { CurveNode, TimeWarpCurve } from '../../shared/model';
import {
  buildCurveSegments,
  canSegmentCurveBendAffectShape,
  evaluateCurveSegments,
  roundCurveNumber,
  resolveNormalizedCurveMaxRate,
} from '../curve-segments';
import {
  DEFAULT_CURVE_DIVISIONS,
  sanitizeCurveDivisions,
} from '../curve-divisions';

const CURVE_ZERO_EPSILON = 1e-6;
const IDENTITY_TIME_WARP_EPSILON = 1e-6;
const DEFAULT_TIME_WARP_CURVE: Readonly<TimeWarpCurve> = Object.freeze({
  divisions: DEFAULT_CURVE_DIVISIONS,
  nodes: [
    { id: 'timewarp-node-start', t: 0, v: 0 },
    { id: 'timewarp-node-end', t: 1, v: 1 },
  ],
});

const sortNodes = (nodes: CurveNode[]): CurveNode[] =>
  [...nodes].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));

const sanitizeNodeId = (value: unknown, fallbackIndex: number): string => {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  return `timewarp-node-${fallbackIndex + 1}`;
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
  const v = clamp(Number((rawNode as { v?: unknown }).v), 0, 1);
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

export const sanitizeTimeWarpCurveNodes = (rawNodes: unknown): CurveNode[] => {
  if (!Array.isArray(rawNodes)) {
    return DEFAULT_TIME_WARP_CURVE.nodes.map((node) => ({ ...node }));
  }

  const normalized = rawNodes
    .map((rawNode, index) => normalizeCurveNode(rawNode, index))
    .filter((node): node is CurveNode => node !== null);

  const dedupedBySnap = new Map<string, CurveNode>();
  for (const node of sortNodes(normalized)) {
    dedupedBySnap.set(node.t.toFixed(6), node);
  }

  const deduped = [...dedupedBySnap.values()];
  if (deduped.length < 2) {
    return DEFAULT_TIME_WARP_CURVE.nodes.map((node) => ({ ...node }));
  }

  const pinned = deduped.map((node, index, nodes) => {
    if (index === 0) {
      return { ...node, t: 0 };
    }
    if (index === nodes.length - 1) {
      return { ...node, t: 1 };
    }
    return node;
  });

  return pinned.map((node, index, nodes) => {
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

export const sanitizeTimeWarpCurve = (raw: unknown): TimeWarpCurve => {
  const source = raw && typeof raw === 'object' ? raw as Partial<TimeWarpCurve> : null;
  return {
    divisions: sanitizeCurveDivisions(source?.divisions),
    nodes: sanitizeTimeWarpCurveNodes(source?.nodes),
  };
};

export const compileTimeWarpCurve = (curve: TimeWarpCurve) => {
  const segments = buildCurveSegments(sanitizeTimeWarpCurve(curve).nodes);
  return {
    segments,
    evaluate: (progress: number): number => evaluateCurveSegments(segments, progress),
  };
};

export const resolveTimeWarpCurveMaxRate = (curve: TimeWarpCurve): number => {
  let maxRate = 1;
  for (const segment of compileTimeWarpCurve(curve).segments) {
    const span = segment.end.t - segment.start.t;
    if (span <= 0) continue;
    maxRate = Math.max(maxRate, Math.abs(segment.end.v - segment.start.v) / span
      * resolveNormalizedCurveMaxRate(segment.bend));
  }
  return maxRate;
};

export const isIdentityTimeWarpCurve = (curve: TimeWarpCurve): boolean =>
  compileTimeWarpCurve(curve).segments.every(({ start, end, bend }) =>
    Math.abs(start.t - start.v) <= IDENTITY_TIME_WARP_EPSILON
    && Math.abs(end.t - end.v) <= IDENTITY_TIME_WARP_EPSILON
    && Math.abs(bend) <= CURVE_ZERO_EPSILON);
