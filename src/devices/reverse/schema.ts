import type { ReverseEffectNode } from '../../shared/model';
import type { RendererDeviceSchema } from '../types';

export const reverseDeviceSchema = {
  kind: 'reverse',
  label: 'Reverse',
  group: 'effect',
  createDefaultNode: (id, enabled): ReverseEffectNode => ({
    id,
    kind: 'reverse',
    enabled: enabled !== false,
    groupId: null,
  }),
} satisfies RendererDeviceSchema<'reverse'>;
