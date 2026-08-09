import type { CurveModulatorNode } from '../../shared/model';
import { sanitizeModulationCurve } from '../../core/modulation/curve';
import { sanitizeModulationTargets } from '../../core/modulation/targets';
import {
  applyImportedDeviceMeta,
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
  device.params.targets = sanitizeModulationTargets(params.targets);
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
