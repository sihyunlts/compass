import type { SpiralGeneratorNode } from '../../shared/model';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_SPIRAL_PARAMS: SpiralGeneratorNode['params'] = {
  centerX: 4.5,
  centerY: 4.5,
  turns: 2,
  startRadius: 0,
};

export const spiralDeviceSchema = {
  kind: 'spiral',
  label: 'Spiral',
  group: 'generator',
  modulationTargetParams: [
    { key: 'centerX', label: 'Center X' },
    { key: 'centerY', label: 'Center Y' },
    { key: 'turns', label: 'Turns' },
    { key: 'startRadius', label: 'Start Radius' },
  ],
  numericParamKeys: ['centerX', 'centerY', 'turns', 'startRadius'],
  createDefaultNode: (id, enabled): SpiralGeneratorNode => ({
    id,
    kind: 'spiral',
    enabled: enabled !== false,
    groupId: null,
    params: { ...DEFAULT_SPIRAL_PARAMS },
  }),
} satisfies RendererDeviceSchema<'spiral'>;
