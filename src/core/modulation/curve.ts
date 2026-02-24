import { clamp } from '../../shared/math';
import type { CurveNode, ModulationCurve } from '../../shared/types';

const MIN_CURVE_DIVISIONS = 2;
const MAX_CURVE_DIVISIONS = 64;
const DEFAULT_CURVE_DIVISIONS = 16;
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

export const sanitizeCurveNodes = (rawNodes: unknown): CurveNode[] => {
  if (!Array.isArray(rawNodes)) {
    return [...DEFAULT_CURVE_NODES];
  }

  const nodes: CurveNode[] = [];
  for (let index = 0; index < rawNodes.length; index += 1) {
    const rawNode = rawNodes[index];
    if (!rawNode || typeof rawNode !== 'object') {
      continue;
    }

    const t = clamp(Number((rawNode as { t?: unknown }).t), 0, 1);
    const v = clamp(Number((rawNode as { v?: unknown }).v), -1, 1);
    if (!Number.isFinite(t) || !Number.isFinite(v)) {
      continue;
    }

    nodes.push({
      id: sanitizeNodeId((rawNode as { id?: unknown }).id, index),
      t: Number(t.toFixed(6)),
      v: Number(v.toFixed(6)),
    });
  }

  const dedupedBySnap = new Map<string, CurveNode>();
  for (const node of sortNodes(nodes)) {
    const key = node.t.toFixed(6);
    dedupedBySnap.set(key, node);
  }

  const sanitized = [...dedupedBySnap.values()];
  if (sanitized.length >= 2) {
    return sanitized;
  }

  return [...DEFAULT_CURVE_NODES];
};

export const sanitizeModulationCurve = (raw: unknown): ModulationCurve => {
  const source = raw && typeof raw === 'object' ? raw as Partial<ModulationCurve> : null;
  return {
    domain: 'loop01',
    divisions: sanitizeCurveDivisions(source?.divisions),
    nodes: sanitizeCurveNodes(source?.nodes),
  };
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
