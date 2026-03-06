import type { MirrorEffectNode } from '../../shared/model';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_MIRROR_PARAMS: MirrorEffectNode['params'] = {
  angleDeg: 90,
};

const MIRROR_MODULATION_TARGET_PARAMS = [
  { key: 'angleDeg', label: 'Mirror Axis Angle' },
] as const;
export const MIRROR_NUMERIC_PARAM_KEYS = ['angleDeg'] as const;

export const mirrorDeviceSchema = {
  kind: 'mirror',
  label: 'Mirror',
  group: 'effect',
  modulationTargetParams: MIRROR_MODULATION_TARGET_PARAMS,
  numericParamKeys: MIRROR_NUMERIC_PARAM_KEYS,
  createDefaultNode: (id, enabled): MirrorEffectNode => ({
    id,
    kind: 'mirror',
    enabled: enabled !== false,
    groupId: null,
    params: { ...DEFAULT_MIRROR_PARAMS },
  }),
} satisfies RendererDeviceSchema<'mirror'>;
