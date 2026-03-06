import type { ScannerGeneratorNode } from '../../shared/model';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_SCANNER_PARAMS: ScannerGeneratorNode['params'] = {
  angleDeg: 0,
  startOffset: 0,
};

export const scannerDeviceSchema = {
  kind: 'scanner',
  label: 'Scanner',
  group: 'generator',
  modulationTargetParams: [
    { key: 'angleDeg', label: 'Angle' },
    { key: 'startOffset', label: 'Start Offset' },
  ],
  numericParamKeys: ['angleDeg', 'startOffset'],
  createDefaultNode: (id, enabled): ScannerGeneratorNode => ({
    id,
    kind: 'scanner',
    enabled: enabled !== false,
    groupId: null,
    params: { ...DEFAULT_SCANNER_PARAMS },
  }),
} satisfies RendererDeviceSchema<'scanner'>;
