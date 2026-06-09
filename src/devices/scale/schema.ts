import type { ScaleEffectNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
  toFiniteNumber,
} from '../import-hydration';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_SCALE_PARAMS: ScaleEffectNode['params'] = {
  centerX: 4.5,
  centerY: 4.5,
  scaleX: 1,
  scaleY: 1,
};

const SCALE_MODULATION_TARGET_PARAMS = [
  { key: 'centerX', label: 'Center X' },
  { key: 'centerY', label: 'Center Y' },
  { key: 'scaleX', label: 'Scale X' },
  { key: 'scaleY', label: 'Scale Y' },
] as const;
const SCALE_NUMERIC_PARAM_KEYS = ['centerX', 'centerY', 'scaleX', 'scaleY'] as const;

export const normalizePositiveScaleFactor = (
  value: unknown,
  fallback: number,
): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const createDefaultScaleNode = (
  id: string,
  enabled: boolean,
): ScaleEffectNode => ({
  id,
  kind: 'scale',
  enabled: enabled !== false,
  groupId: null,
  params: { ...DEFAULT_SCALE_PARAMS },
});

const hydrateImportedScaleNode = (
  source: Record<string, unknown>,
): ScaleEffectNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultScaleNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  device.params.centerX = toFiniteNumber(params.centerX, device.params.centerX);
  device.params.centerY = toFiniteNumber(params.centerY, device.params.centerY);
  device.params.scaleX = normalizePositiveScaleFactor(params.scaleX, device.params.scaleX);
  device.params.scaleY = normalizePositiveScaleFactor(params.scaleY, device.params.scaleY);
  return device;
};

export const scaleDeviceSchema = {
  kind: 'scale',
  label: 'Scale',
  group: 'effect',
  modulationTargetParams: SCALE_MODULATION_TARGET_PARAMS,
  numericParamKeys: SCALE_NUMERIC_PARAM_KEYS,
  createDefaultNode: createDefaultScaleNode,
  hydrateImportedNode: hydrateImportedScaleNode,
} satisfies RendererDeviceSchema<'scale'>;
