import type { RendererDeviceSchema } from '../types';

export const mirrorDeviceSchema = {
  kind: 'mirror',
  label: 'Mirror',
  group: 'effect',
  modulationTargetParams: [
    { key: 'angleDeg', label: 'Mirror Axis Angle' },
  ],
} satisfies RendererDeviceSchema<'mirror'>;
