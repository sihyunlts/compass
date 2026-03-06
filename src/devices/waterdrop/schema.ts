import type { WaterdropGeneratorNode } from '../../shared/model';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_WATERDROP_PARAMS: WaterdropGeneratorNode['params'] = {
  centerX: 4.5,
  centerY: 4.5,
  curvature: 2,
  startRadius: 0,
};

export const waterdropDeviceSchema = {
  kind: 'waterdrop',
  label: 'Waterdrop',
  group: 'generator',
  modulationTargetParams: [
    { key: 'centerX', label: 'Center X' },
    { key: 'centerY', label: 'Center Y' },
    { key: 'curvature', label: 'Curvature' },
    { key: 'startRadius', label: 'Start Radius' },
  ],
  numericParamKeys: ['centerX', 'centerY', 'curvature', 'startRadius'],
  createDefaultNode: (id, enabled): WaterdropGeneratorNode => ({
    id,
    kind: 'waterdrop',
    enabled: enabled !== false,
    groupId: null,
    params: { ...DEFAULT_WATERDROP_PARAMS },
  }),
} satisfies RendererDeviceSchema<'waterdrop'>;
