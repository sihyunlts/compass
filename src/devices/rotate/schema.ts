import type { RendererDeviceSchema } from '../types';

export const rotateDeviceSchema = {
  kind: 'rotate',
  label: 'Rotate',
  group: 'effect',
  modulationTargetParams: [
    { key: 'angleDeg', label: 'Angle' },
  ],
} satisfies RendererDeviceSchema<'rotate'>;
