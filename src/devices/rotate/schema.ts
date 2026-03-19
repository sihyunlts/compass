import type { RotateEffectNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
  toFiniteNumber,
} from '../import-hydration';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_ROTATE_PARAMS: RotateEffectNode['params'] = {
  angleDeg: 90,
};

const ROTATE_MODULATION_TARGET_PARAMS = [
  { key: 'angleDeg', label: 'Angle' },
] as const;
export const ROTATE_NUMERIC_PARAM_KEYS = ['angleDeg'] as const;

const createDefaultRotateNode = (
  id: string,
  enabled: boolean,
): RotateEffectNode => ({
  id,
  kind: 'rotate',
  enabled: enabled !== false,
  groupId: null,
  params: { ...DEFAULT_ROTATE_PARAMS },
});

const hydrateImportedRotateNode = (
  source: Record<string, unknown>,
): RotateEffectNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultRotateNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  device.params.angleDeg = toFiniteNumber(params.angleDeg, device.params.angleDeg);
  return device;
};

export const rotateDeviceSchema = {
  kind: 'rotate',
  label: 'Rotate',
  group: 'effect',
  modulationTargetParams: ROTATE_MODULATION_TARGET_PARAMS,
  numericParamKeys: ROTATE_NUMERIC_PARAM_KEYS,
  createDefaultNode: createDefaultRotateNode,
  hydrateImportedNode: hydrateImportedRotateNode,
} satisfies RendererDeviceSchema<'rotate'>;
