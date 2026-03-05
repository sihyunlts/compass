import type { RendererDeviceSchema } from '../types';

export const scannerDeviceSchema = {
  kind: 'scanner',
  label: 'Scanner',
  group: 'generator',
  modulationTargetParams: [
    { key: 'angleDeg', label: 'Angle' },
    { key: 'startOffset', label: 'Start Offset' },
  ],
} satisfies RendererDeviceSchema<'scanner'>;
