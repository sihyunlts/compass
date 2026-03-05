import type { RendererDeviceSchema } from '../types';

export const modulatorDeviceSchema = {
  kind: 'modulator',
  label: 'Modulator',
  group: 'effect',
} satisfies RendererDeviceSchema<'modulator'>;
