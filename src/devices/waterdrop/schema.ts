import type { WaterdropGeneratorNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
  toFiniteNumber,
} from '../import-hydration';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_WATERDROP_PARAMS: WaterdropGeneratorNode['params'] = {
  centerX: 4.5,
  centerY: 4.5,
  curvature: 2,
  startRadius: 0,
};

const WATERDROP_MODULATION_TARGET_PARAMS = [
  { key: 'centerX', label: 'Center X' },
  { key: 'centerY', label: 'Center Y' },
  { key: 'curvature', label: 'Curvature' },
  { key: 'startRadius', label: 'Start Radius' },
] as const;
export const WATERDROP_NUMERIC_PARAM_KEYS = ['centerX', 'centerY', 'curvature', 'startRadius'] as const;

const createDefaultWaterdropNode = (
  id: string,
  enabled: boolean,
): WaterdropGeneratorNode => ({
  id,
  kind: 'waterdrop',
  enabled: enabled !== false,
  groupId: null,
  params: { ...DEFAULT_WATERDROP_PARAMS },
});

const hydrateImportedWaterdropNode = (
  source: Record<string, unknown>,
): WaterdropGeneratorNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultWaterdropNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  device.params.centerX = toFiniteNumber(params.centerX, device.params.centerX);
  device.params.centerY = toFiniteNumber(params.centerY, device.params.centerY);
  device.params.curvature = toFiniteNumber(params.curvature, device.params.curvature);
  device.params.startRadius = toFiniteNumber(params.startRadius, device.params.startRadius);
  return device;
};

export const waterdropDeviceSchema = {
  kind: 'waterdrop',
  label: 'Waterdrop',
  group: 'generator',
  modulationTargetParams: WATERDROP_MODULATION_TARGET_PARAMS,
  numericParamKeys: WATERDROP_NUMERIC_PARAM_KEYS,
  createDefaultNode: createDefaultWaterdropNode,
  hydrateImportedNode: hydrateImportedWaterdropNode,
} satisfies RendererDeviceSchema<'waterdrop'>;
