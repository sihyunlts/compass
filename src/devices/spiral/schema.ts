import type { RendererDeviceSchema } from '../types';

export const spiralDeviceSchema = {
  kind: 'spiral',
  label: 'Spiral',
  group: 'generator',
  modulationTargetParams: [
    { key: 'centerX', label: 'Center X' },
    { key: 'centerY', label: 'Center Y' },
    { key: 'turns', label: 'Turns' },
    { key: 'startRadius', label: 'Start Radius' },
  ],
} satisfies RendererDeviceSchema<'spiral'>;
