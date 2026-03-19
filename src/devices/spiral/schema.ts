import type { SpiralGeneratorNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
  toFiniteNumber,
} from '../import-hydration';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_SPIRAL_PARAMS: SpiralGeneratorNode['params'] = {
  centerX: 4.5,
  centerY: 4.5,
  turns: 2,
  startRadius: 0,
};

const SPIRAL_MODULATION_TARGET_PARAMS = [
  { key: 'centerX', label: 'Center X' },
  { key: 'centerY', label: 'Center Y' },
  { key: 'turns', label: 'Turns' },
  { key: 'startRadius', label: 'Start Radius' },
] as const;
export const SPIRAL_NUMERIC_PARAM_KEYS = ['centerX', 'centerY', 'turns', 'startRadius'] as const;

const createDefaultSpiralNode = (
  id: string,
  enabled: boolean,
): SpiralGeneratorNode => ({
  id,
  kind: 'spiral',
  enabled: enabled !== false,
  groupId: null,
  params: { ...DEFAULT_SPIRAL_PARAMS },
});

const hydrateImportedSpiralNode = (
  source: Record<string, unknown>,
): SpiralGeneratorNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultSpiralNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  device.params.centerX = toFiniteNumber(params.centerX, device.params.centerX);
  device.params.centerY = toFiniteNumber(params.centerY, device.params.centerY);
  device.params.turns = toFiniteNumber(params.turns, device.params.turns);
  device.params.startRadius = toFiniteNumber(params.startRadius, device.params.startRadius);
  return device;
};

export const spiralDeviceSchema = {
  kind: 'spiral',
  label: 'Spiral',
  group: 'generator',
  modulationTargetParams: SPIRAL_MODULATION_TARGET_PARAMS,
  numericParamKeys: SPIRAL_NUMERIC_PARAM_KEYS,
  createDefaultNode: createDefaultSpiralNode,
  hydrateImportedNode: hydrateImportedSpiralNode,
} satisfies RendererDeviceSchema<'spiral'>;
