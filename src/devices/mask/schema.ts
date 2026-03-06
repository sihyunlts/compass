import type { MaskEffectNode } from '../../shared/model';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_MASK_PARAMS: MaskEffectNode['params'] = {
  mode: 'include',
  tiles: [],
  sourceKind: 'tiles',
  sourceId: null,
  sourceVisibility: 'hide',
};

export const maskDeviceSchema = {
  kind: 'mask',
  label: 'Mask',
  group: 'effect',
  createDefaultNode: (id, enabled): MaskEffectNode => ({
    id,
    kind: 'mask',
    enabled: enabled !== false,
    groupId: null,
    params: {
      mode: DEFAULT_MASK_PARAMS.mode,
      tiles: [...DEFAULT_MASK_PARAMS.tiles],
      sourceKind: DEFAULT_MASK_PARAMS.sourceKind,
      sourceId: DEFAULT_MASK_PARAMS.sourceId,
      sourceVisibility: DEFAULT_MASK_PARAMS.sourceVisibility,
    },
  }),
} satisfies RendererDeviceSchema<'mask'>;
