import type { RendererDeviceSchema } from '../types';

export const symmetryDeviceSchema = {
  kind: 'symmetry',
  label: 'Symmetry',
  group: 'effect',
} satisfies RendererDeviceSchema<'symmetry'>;
