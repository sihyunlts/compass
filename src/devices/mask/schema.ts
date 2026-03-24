import type { MaskEffectNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedOptionalId,
  resolveImportedParams,
  toIntegerArray,
} from '../import-hydration';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_MASK_PARAMS: MaskEffectNode['params'] = {
  mode: 'include',
  tiles: [],
  sourceKind: 'tiles',
  sourceDomain: 'activation',
  sourceId: null,
  sourceVisibility: 'hide',
};

const createDefaultMaskNode = (
  id: string,
  enabled: boolean,
): MaskEffectNode => ({
  id,
  kind: 'mask',
  enabled: enabled !== false,
  groupId: null,
  params: {
    mode: DEFAULT_MASK_PARAMS.mode,
    tiles: [...DEFAULT_MASK_PARAMS.tiles],
    sourceKind: DEFAULT_MASK_PARAMS.sourceKind,
    sourceDomain: DEFAULT_MASK_PARAMS.sourceDomain,
    sourceId: DEFAULT_MASK_PARAMS.sourceId,
    sourceVisibility: DEFAULT_MASK_PARAMS.sourceVisibility,
  },
});

const hydrateImportedMaskNode = (
  source: Record<string, unknown>,
): MaskEffectNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultMaskNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  device.params.mode = params.mode === 'exclude' ? 'exclude' : DEFAULT_MASK_PARAMS.mode;
  device.params.tiles = toIntegerArray(params.tiles);
  device.params.sourceKind = params.sourceKind === 'group'
    || params.sourceKind === 'generator'
    || params.sourceKind === 'tiles'
    ? params.sourceKind
    : DEFAULT_MASK_PARAMS.sourceKind;
  device.params.sourceDomain = params.sourceDomain === 'scene'
    || params.sourceDomain === 'activation'
    ? params.sourceDomain
    : DEFAULT_MASK_PARAMS.sourceDomain;
  device.params.sourceVisibility = params.sourceVisibility === 'show'
    ? 'show'
    : DEFAULT_MASK_PARAMS.sourceVisibility;
  device.params.sourceId = device.params.sourceKind === 'tiles'
    ? null
    : resolveImportedOptionalId(params.sourceId);
  return device;
};

export const maskDeviceSchema = {
  kind: 'mask',
  label: 'Mask',
  group: 'effect',
  createDefaultNode: createDefaultMaskNode,
  hydrateImportedNode: hydrateImportedMaskNode,
} satisfies RendererDeviceSchema<'mask'>;
