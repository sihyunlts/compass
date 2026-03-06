import type { SpiralGeneratorNode } from '../../shared/model';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_SPIRAL_PARAMS: SpiralGeneratorNode['params'] = {
  centerX: 4.5,
  centerY: 4.5,
  turns: 2,
  startRadius: 0,
};

const SPIRAL_MODULATION_TARGET_PARAMS = [
  { key: 'centerX', label: 'Center X' },
  { key: 'centerY', label: 'Center Y' },
  { key: 'turns', label: 'Turns' },
  { key: 'startRadius', label: 'Start Radius' },
] as const;
export const SPIRAL_NUMERIC_PARAM_KEYS = ['centerX', 'centerY', 'turns', 'startRadius'] as const;

export const spiralDeviceSchema = {
  kind: 'spiral',
  label: 'Spiral',
  group: 'generator',
  modulationTargetParams: SPIRAL_MODULATION_TARGET_PARAMS,
  numericParamKeys: SPIRAL_NUMERIC_PARAM_KEYS,
  createDefaultNode: (id, enabled): SpiralGeneratorNode => ({
    id,
    kind: 'spiral',
    enabled: enabled !== false,
    groupId: null,
    params: { ...DEFAULT_SPIRAL_PARAMS },
  }),
} satisfies RendererDeviceSchema<'spiral'>;
