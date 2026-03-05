import type { RendererDeviceSchema } from '../types';

export const waterdropDeviceSchema = {
  kind: 'waterdrop',
  label: 'Waterdrop',
  group: 'generator',
  modulationTargetParams: [
    { key: 'centerX', label: 'Center X' },
    { key: 'centerY', label: 'Center Y' },
    { key: 'curvature', label: 'Curvature' },
    { key: 'startRadius', label: 'Start Radius' },
  ],
} satisfies RendererDeviceSchema<'waterdrop'>;
