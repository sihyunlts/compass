import { clamp } from '../../shared/math';
import type { CurveNode, ModulationCurve } from '../../shared/model';
import { sanitizeCurveDivisions } from '../curve-divisions';
import { sanitizeGraphNodes } from '../curve-nodes';
export { buildCurveSegments, evaluateCurveSegments } from '../curve-segments';
export type { CurveSegment } from '../curve-segments';

const DEFAULT_CURVE_NODES: ReadonlyArray<CurveNode> = [
  { id: 'curve-node-start', t: 0, v: 0 },
  { id: 'curve-node-end', t: 1, v: 0 },
];

export const sanitizeCurveNodes = (rawNodes: unknown): CurveNode[] =>
  sanitizeGraphNodes(rawNodes, -1, DEFAULT_CURVE_NODES, false);

export const sanitizeModulationCurve = (raw: unknown): ModulationCurve => {
  const source = raw && typeof raw === 'object' ? raw as Partial<ModulationCurve> : null;
  return {
    domain: 'loop01',
    divisions: sanitizeCurveDivisions(source?.divisions),
    nodes: sanitizeCurveNodes(source?.nodes),
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
