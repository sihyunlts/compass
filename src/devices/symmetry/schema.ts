import type { SymmetryEffectNode } from '../../shared/model';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_SYMMETRY_PARAMS: SymmetryEffectNode['params'] = {
  mode: 'mirror-half',
  axis: 'horizontal',
  sourceAnchor: 'bl',
};

export const symmetryDeviceSchema = {
  kind: 'symmetry',
  label: 'Symmetry',
  group: 'effect',
  createDefaultNode: (id, enabled): SymmetryEffectNode => ({
    id,
    kind: 'symmetry',
    enabled: enabled !== false,
    groupId: null,
    params: { ...DEFAULT_SYMMETRY_PARAMS },
  }),
} satisfies RendererDeviceSchema<'symmetry'>;
