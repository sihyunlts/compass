import type { ScannerGeneratorNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
  toFiniteNumber,
} from '../import-hydration';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_SCANNER_PARAMS: ScannerGeneratorNode['params'] = {
  angleDeg: 0,
  startOffset: 0,
};

const SCANNER_MODULATION_TARGET_PARAMS = [
  { key: 'angleDeg', label: 'Angle' },
  { key: 'startOffset', label: 'Start Offset' },
] as const;
export const SCANNER_NUMERIC_PARAM_KEYS = ['angleDeg', 'startOffset'] as const;

const createDefaultScannerNode = (
  id: string,
  enabled: boolean,
): ScannerGeneratorNode => ({
  id,
  kind: 'scanner',
  enabled: enabled !== false,
  groupId: null,
  params: { ...DEFAULT_SCANNER_PARAMS },
});

const hydrateImportedScannerNode = (
  source: Record<string, unknown>,
): ScannerGeneratorNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultScannerNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  device.params.angleDeg = toFiniteNumber(params.angleDeg, device.params.angleDeg);
  device.params.startOffset = toFiniteNumber(params.startOffset, device.params.startOffset);
  return device;
};

export const scannerDeviceSchema = {
  kind: 'scanner',
  label: 'Scanner',
  group: 'generator',
  modulationTargetParams: SCANNER_MODULATION_TARGET_PARAMS,
  numericParamKeys: SCANNER_NUMERIC_PARAM_KEYS,
  createDefaultNode: createDefaultScannerNode,
  hydrateImportedNode: hydrateImportedScannerNode,
} satisfies RendererDeviceSchema<'scanner'>;
