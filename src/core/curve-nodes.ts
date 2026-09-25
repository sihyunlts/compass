import { clamp } from '../shared/math';
import type { CurveNode } from '../shared/model';

const readHandle = (value: unknown): CurveNode['handleIn'] => {
  if (!value || typeof value !== 'object') return undefined;
  const { t, v } = value as { t?: unknown; v?: unknown };
  return typeof t === 'number' && Number.isFinite(t)
    && typeof v === 'number' && Number.isFinite(v) ? { t, v } : undefined;
};

/** Shared graph constraints; handles are offsets so moving a node carries them. */
export const sanitizeGraphNodes = (
  raw: unknown,
  valueMin: number,
  defaults: ReadonlyArray<CurveNode>,
  pinTimeEndpoints: boolean,
): CurveNode[] => {
  if (!Array.isArray(raw)) return defaults.map((node) => ({ ...node }));
  const byTime = new Map<number, CurveNode>();
  for (const [index, value] of raw.entries()) {
    if (!value || typeof value !== 'object') continue;
    const t = clamp(Number(value.t), 0, 1);
    const v = clamp(Number(value.v), valueMin, 1);
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    const handleIn = readHandle(value.handleIn);
    const handleOut = readHandle(value.handleOut);
    byTime.set(t, {
      id: typeof value.id === 'string' && value.id.trim() ? value.id : `curve-node-${index + 1}`,
      t, v,
      ...(handleIn ? { handleIn } : {}),
      ...(handleOut ? { handleOut } : {}),
    });
  }
  const nodes = [...byTime.values()].sort((a, b) => a.t - b.t);
  if (nodes.length < 2) return defaults.map((node) => ({ ...node }));
  if (pinTimeEndpoints) {
    nodes[0].t = 0;
    nodes[nodes.length - 1].t = 1;
  }
  return nodes.map((node, index) => {
    const result: CurveNode = { id: node.id, t: node.t, v: node.v };
    for (const kind of ['handleIn', 'handleOut'] as const) {
      const neighbor = nodes[index + (kind === 'handleIn' ? -1 : 1)];
      const handle = node[kind];
      if (!neighbor || !handle) continue;
      // Shorten at the graph boundary without changing a linked tangent's angle.
      let scale = 1;
      if (handle.t !== 0) {
        const timeLimit = handle.t < 0 ? Math.min(0, neighbor.t - node.t) : Math.max(0, neighbor.t - node.t);
        scale = Math.min(scale, Math.max(0, timeLimit / handle.t));
      }
      if (handle.v !== 0) {
        const valueLimit = handle.v < 0 ? valueMin - node.v : 1 - node.v;
        scale = Math.min(scale, Math.max(0, valueLimit / handle.v));
      }
      result[kind] = { t: handle.t * scale, v: handle.v * scale };
    }
    return result;
  });
};
