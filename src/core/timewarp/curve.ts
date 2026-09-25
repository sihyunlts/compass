import type { CurveNode, TimeWarpCurve } from '../../shared/model';
import {
  buildCurveSegments,
  evaluateCurveSegments,
  resolveCurveSegmentMaxRate,
  splitCurveAtValueExtrema,
} from '../curve-segments';
import {
  DEFAULT_CURVE_DIVISIONS,
  sanitizeCurveDivisions,
} from '../curve-divisions';
import { sanitizeGraphNodes } from '../curve-nodes';

const IDENTITY_TIME_WARP_EPSILON = 1e-6;
const DEFAULT_TIME_WARP_CURVE: Readonly<TimeWarpCurve> = Object.freeze({
  divisions: DEFAULT_CURVE_DIVISIONS,
  nodes: [
    { id: 'timewarp-node-start', t: 0, v: 0 },
    { id: 'timewarp-node-end', t: 1, v: 1 },
  ],
});

export const sanitizeTimeWarpCurveNodes = (rawNodes: unknown): CurveNode[] =>
  sanitizeGraphNodes(rawNodes, 0, DEFAULT_TIME_WARP_CURVE.nodes, true);

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
    isIdentity: segments.every((segment) =>
      [segment.start, segment.controlOut, segment.controlIn, segment.end].every((point) =>
        Math.abs(point.t - point.v) <= IDENTITY_TIME_WARP_EPSILON)),
    segments: segments.flatMap(splitCurveAtValueExtrema),
    evaluate: (progress: number): number => evaluateCurveSegments(segments, progress),
  };
};

export const resolveTimeWarpCurveMaxRate = (curve: TimeWarpCurve): number =>
  Math.max(1, ...buildCurveSegments(sanitizeTimeWarpCurve(curve).nodes).map(resolveCurveSegmentMaxRate));
