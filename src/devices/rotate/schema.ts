import type { RotateEffectNode } from '../../shared/model';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_ROTATE_PARAMS: RotateEffectNode['params'] = {
  angleDeg: 90,
};

const ROTATE_MODULATION_TARGET_PARAMS = [
  { key: 'angleDeg', label: 'Angle' },
] as const;
export const ROTATE_NUMERIC_PARAM_KEYS = ['angleDeg'] as const;

export const rotateDeviceSchema = {
  kind: 'rotate',
  label: 'Rotate',
  group: 'effect',
  modulationTargetParams: ROTATE_MODULATION_TARGET_PARAMS,
  numericParamKeys: ROTATE_NUMERIC_PARAM_KEYS,
  createDefaultNode: (id, enabled): RotateEffectNode => ({
    id,
    kind: 'rotate',
    enabled: enabled !== false,
    groupId: null,
    params: { ...DEFAULT_ROTATE_PARAMS },
  }),
} satisfies RendererDeviceSchema<'rotate'>;
