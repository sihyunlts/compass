import type { RotateEffectNode } from '../../shared/model';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_ROTATE_PARAMS: RotateEffectNode['params'] = {
  angleDeg: 90,
};

export const rotateDeviceSchema = {
  kind: 'rotate',
  label: 'Rotate',
  group: 'effect',
  modulationTargetParams: [
    { key: 'angleDeg', label: 'Angle' },
  ],
  numericParamKeys: ['angleDeg'],
  createDefaultNode: (id, enabled): RotateEffectNode => ({
    id,
    kind: 'rotate',
    enabled: enabled !== false,
    groupId: null,
    params: { ...DEFAULT_ROTATE_PARAMS },
  }),
} satisfies RendererDeviceSchema<'rotate'>;
