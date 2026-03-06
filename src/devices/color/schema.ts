import type { ColorEffectNode } from '../../shared/model';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_COLOR_PARAMS: ColorEffectNode['params'] = {
  velocities: [3],
  noteLengthPercent: 100,
};

const COLOR_NUMERIC_PARAM_KEYS = ['noteLengthPercent'] as const;

export const colorDeviceSchema = {
  kind: 'color',
  label: 'Color',
  group: 'effect',
  numericParamKeys: COLOR_NUMERIC_PARAM_KEYS,
  createDefaultNode: (id, enabled): ColorEffectNode => ({
    id,
    kind: 'color',
    enabled: enabled !== false,
    groupId: null,
    params: {
      velocities: [...DEFAULT_COLOR_PARAMS.velocities],
      noteLengthPercent: DEFAULT_COLOR_PARAMS.noteLengthPercent,
    },
  }),
} satisfies RendererDeviceSchema<'color'>;
