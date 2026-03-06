import type { MirrorEffectNode } from '../../shared/model';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_MIRROR_PARAMS: MirrorEffectNode['params'] = {
  angleDeg: 90,
};

export const mirrorDeviceSchema = {
  kind: 'mirror',
  label: 'Mirror',
  group: 'effect',
  modulationTargetParams: [
    { key: 'angleDeg', label: 'Mirror Axis Angle' },
  ],
  numericParamKeys: ['angleDeg'],
  createDefaultNode: (id, enabled): MirrorEffectNode => ({
    id,
    kind: 'mirror',
    enabled: enabled !== false,
    groupId: null,
    params: { ...DEFAULT_MIRROR_PARAMS },
  }),
} satisfies RendererDeviceSchema<'mirror'>;
