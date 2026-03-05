import type { RendererDeviceSchema } from '../types';

export const colorDeviceSchema = {
  kind: 'color',
  label: 'Color',
  group: 'effect',
} satisfies RendererDeviceSchema<'color'>;
