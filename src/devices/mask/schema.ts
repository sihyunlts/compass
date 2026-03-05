import type { RendererDeviceSchema } from '../types';

export const maskDeviceSchema = {
  kind: 'mask',
  label: 'Mask',
  group: 'effect',
} satisfies RendererDeviceSchema<'mask'>;
