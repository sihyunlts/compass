import type { ScannerGeneratorNode } from '../../shared/model';
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

export const scannerDeviceSchema = {
  kind: 'scanner',
  label: 'Scanner',
  group: 'generator',
  modulationTargetParams: SCANNER_MODULATION_TARGET_PARAMS,
  numericParamKeys: SCANNER_NUMERIC_PARAM_KEYS,
  createDefaultNode: (id, enabled): ScannerGeneratorNode => ({
    id,
    kind: 'scanner',
    enabled: enabled !== false,
    groupId: null,
    params: { ...DEFAULT_SCANNER_PARAMS },
  }),
} satisfies RendererDeviceSchema<'scanner'>;
