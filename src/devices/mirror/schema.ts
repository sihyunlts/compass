import type { MirrorEffectNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
  toFiniteNumber,
} from '../import-hydration';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_MIRROR_PARAMS: MirrorEffectNode['params'] = {
  angleDeg: 90,
};

const MIRROR_MODULATION_TARGET_PARAMS = [
  { key: 'angleDeg', label: 'Mirror Axis Angle' },
] as const;
export const MIRROR_NUMERIC_PARAM_KEYS = ['angleDeg'] as const;

const createDefaultMirrorNode = (
  id: string,
  enabled: boolean,
): MirrorEffectNode => ({
  id,
  kind: 'mirror',
  enabled: enabled !== false,
  groupId: null,
  params: { ...DEFAULT_MIRROR_PARAMS },
});

const hydrateImportedMirrorNode = (
  source: Record<string, unknown>,
): MirrorEffectNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultMirrorNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  device.params.angleDeg = toFiniteNumber(params.angleDeg, device.params.angleDeg);
  return device;
};

export const mirrorDeviceSchema = {
  kind: 'mirror',
  label: 'Mirror',
  group: 'effect',
  modulationTargetParams: MIRROR_MODULATION_TARGET_PARAMS,
  numericParamKeys: MIRROR_NUMERIC_PARAM_KEYS,
  createDefaultNode: createDefaultMirrorNode,
  hydrateImportedNode: hydrateImportedMirrorNode,
} satisfies RendererDeviceSchema<'mirror'>;
