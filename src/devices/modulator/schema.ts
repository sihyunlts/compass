import type { CurveModulatorNode } from '../../shared/model';
import { sanitizeModulationCurve } from '../../core/modulation/curve';
import {
  sanitizeModulationTarget,
  sanitizeModulationTargets,
} from '../../core/modulation/routing';
import {
  applyImportedDeviceMeta,
  isImportRecord,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
} from '../import-hydration';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_MODULATOR_PARAMS: CurveModulatorNode['params'] = {
  targets: [],
  curve: {
    domain: 'loop01',
    divisions: 16,
    nodes: [
      { id: 'curve-node-start', t: 0, v: 0 },
      { id: 'curve-node-end', t: 1, v: 0 },
    ],
  },
};

const LEGACY_MODULATION_TARGET_ID = 'mod-target-legacy';
const LEGACY_MODULATION_TARGET_SLOT_INDEX = 0;

const createDefaultModulatorNode = (
  id: string,
  enabled: boolean,
): CurveModulatorNode => ({
  id,
  kind: 'modulator',
  enabled: enabled !== false,
  groupId: null,
  params: {
    targets: [],
    curve: {
      domain: DEFAULT_MODULATOR_PARAMS.curve.domain,
      divisions: DEFAULT_MODULATOR_PARAMS.curve.divisions,
      nodes: DEFAULT_MODULATOR_PARAMS.curve.nodes.map((node) => ({ ...node })),
    },
  },
});

const hydrateImportedModulationTargets = (
  params: Record<string, unknown>,
): CurveModulatorNode['params']['targets'] => {
  const targets = sanitizeModulationTargets(params.targets);
  if (Array.isArray(params.targets) || targets.length > 0) {
    return targets;
  }

  // Temporary backward compatibility for the old single-target Modulator format.
  // TODO: Remove this legacy block after params.target/params.amount racks are no longer supported.
  if (!isImportRecord(params.target)) {
    return [];
  }

  const legacyTarget = sanitizeModulationTarget({
    ...params.target,
    id: LEGACY_MODULATION_TARGET_ID,
    slotIndex: LEGACY_MODULATION_TARGET_SLOT_INDEX,
    amount: params.amount,
  });
  return legacyTarget ? [legacyTarget] : [];
};

const hydrateImportedModulatorNode = (
  source: Record<string, unknown>,
): CurveModulatorNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultModulatorNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  device.params.targets = hydrateImportedModulationTargets(params);
  device.params.curve = sanitizeModulationCurve(params.curve);
  return device;
};

export const modulatorDeviceSchema = {
  kind: 'modulator',
  label: 'Modulator',
  group: 'effect',
  createDefaultNode: createDefaultModulatorNode,
  hydrateImportedNode: hydrateImportedModulatorNode,
} satisfies RendererDeviceSchema<'modulator'>;
