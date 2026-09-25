import { clamp } from '../math';
import { fitPowerCurve } from './power-curve-fit';
import type { CurveNode } from '../model';
import { roundCurveNumber } from '../../core/curve-segments';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// Convert only at the preset boundary, retaining the user's original anchors.
// Handle fitting and knot reduction are separate from runtime curve evaluation.
const migrateNodes = (raw: unknown[], isTimeWarp: boolean): CurveNode[] => {
  // Normalize the legacy anchors before fitting. Clamping or pinning them after
  // conversion would change the fitted handles relative to their segment.
  const normalized = raw.filter(isRecord).map((node, index) => ({
    id: typeof node.id === 'string' && node.id.trim()
      ? node.id : `${isTimeWarp ? 'timewarp' : 'curve'}-node-${index + 1}`,
    t: roundCurveNumber(clamp(Number(node.t), 0, 1)),
    v: roundCurveNumber(clamp(Number(node.v), isTimeWarp ? 0 : -1, 1)),
    bend: Number.isFinite(Number(node.nextCurveBend))
      ? roundCurveNumber(clamp(Number(node.nextCurveBend), -1, 1)) : 0,
  })).filter((node) => Number.isFinite(node.t) && Number.isFinite(node.v))
    .sort((a, b) => a.t - b.t || (isTimeWarp ? a.id.localeCompare(b.id) : 0));
  const nodes = [...new Map(normalized.map((node) => [node.t, node])).values()];
  if (isTimeWarp && nodes.length >= 2) {
    nodes[0].t = 0;
    nodes[nodes.length - 1].t = 1;
  }
  const result: CurveNode[] = [];
  const fittedByBend = new Map<number, ReturnType<typeof fitPowerCurve>>();
  const usedIds = new Set(nodes.map((node) => node.id));
  for (let index = 0; index < nodes.length; index += 1) {
    const start = nodes[index];
    if (!result.length) result.push({ id: start.id, t: start.t, v: start.v });
    const end = nodes[index + 1];
    if (!end) break;
    if (Math.abs(start.bend) <= 1e-6 || start.v === end.v || end.t <= start.t) {
      result.push({ id: end.id, t: end.t, v: end.v });
      continue;
    }
    let splitIndex = 0;
    const timeSpan = end.t - start.t;
    const valueSpan = end.v - start.v;
    let fitted = fittedByBend.get(start.bend);
    if (!fitted) {
      fitted = fitPowerCurve(start.bend);
      fittedByBend.set(start.bend, fitted);
    }
    for (const segment of fitted) {
      const previous = result[result.length - 1];
      previous.handleOut = {
        t: timeSpan * (segment.controlOut.t - segment.start.t),
        v: valueSpan * (segment.controlOut.v - segment.start.v),
      };
      let id = end.id;
      if (segment.end.t !== 1) {
        do { id = `${start.id}-bezier-${++splitIndex}`; } while (usedIds.has(id));
        usedIds.add(id);
      }
      result.push({
        id,
        t: segment.end.t === 1 ? end.t : start.t + timeSpan * segment.end.t,
        v: segment.end.t === 1 ? end.v : start.v + valueSpan * segment.end.v,
        handleIn: {
          t: timeSpan * (segment.controlIn.t - segment.end.t),
          v: valueSpan * (segment.controlIn.v - segment.end.v),
        },
      });
    }
  }
  return result;
};

const migrateDeviceCurve = (value: unknown): unknown => {
  if (!isRecord(value) || (value.kind !== 'modulator' && value.kind !== 'timewarp')
    || !isRecord(value.params) || !isRecord(value.params.curve)) return value;
  const nodes = value.params.curve.nodes;
  if (!Array.isArray(nodes) || !nodes.some((node) => isRecord(node) && 'nextCurveBend' in node)) return value;
  return {
    ...value,
    params: {
      ...value.params,
      curve: { ...value.params.curve, nodes: migrateNodes(nodes, value.kind === 'timewarp') },
    },
  };
};

/** Also upgrades drafts of the unreleased schema 2; the release adds one version only. */
export const migratePresetCurves = (value: Record<string, unknown>): Record<string, unknown> => {
  if (value.presetType === 'device') {
    const device = migrateDeviceCurve(value.device);
    return device === value.device ? value : { ...value, device };
  }
  const key = value.presetType === 'rack' ? 'chain' : value.presetType === 'group' ? 'group' : null;
  const container = key ? value[key] : null;
  if (!key || !isRecord(container) || !Array.isArray(container.devices)) return value;
  const originalDevices = container.devices;
  const devices = originalDevices.map(migrateDeviceCurve);
  return devices.every((device, index) => device === originalDevices[index])
    ? value : { ...value, [key]: { ...container, devices } };
};
