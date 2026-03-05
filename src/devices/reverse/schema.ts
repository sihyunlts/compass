import type { RendererDeviceSchema } from '../types';

export const reverseDeviceSchema = {
  kind: 'reverse',
  label: 'Reverse',
  group: 'effect',
} satisfies RendererDeviceSchema<'reverse'>;
