import type { ColorEffectNode } from '../../shared/model';
import { clamp } from '../../shared/math';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
  toFiniteNumber,
  toIntegerArray,
} from '../import-hydration';
import type { RendererDeviceSchema } from '../types';

const MAX_COLOR_PERCENT = 400;

export const DEFAULT_COLOR_PARAMS: ColorEffectNode['params'] = {
  velocities: [3],
  noteLengthPercent: 100,
  gapPercent: 0,
};

const COLOR_NUMERIC_PARAM_KEYS = ['noteLengthPercent', 'gapPercent'] as const;

const createDefaultColorNode = (
  id: string,
  enabled: boolean,
): ColorEffectNode => ({
  id,
  kind: 'color',
  enabled: enabled !== false,
  groupId: null,
  params: normalizeColorDeviceParams(DEFAULT_COLOR_PARAMS),
});

const hydrateImportedColorNode = (
  source: Record<string, unknown>,
): ColorEffectNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultColorNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  device.params = {
    velocities: toIntegerArray(params.velocities),
    noteLengthPercent: toFiniteNumber(
      params.noteLengthPercent,
      device.params.noteLengthPercent,
    ),
    gapPercent: normalizeColorDeviceParams(params).gapPercent,
  };
  if (device.params.velocities.length === 0) {
    device.params.velocities = [...DEFAULT_COLOR_PARAMS.velocities];
  }
  return device;
};

export const sanitizeColorGapPercent = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_COLOR_PARAMS.gapPercent;
  }

  return clamp(numeric, 0, MAX_COLOR_PERCENT);
};

export const normalizeColorDeviceParams = (
  params: Partial<ColorEffectNode['params']> | null | undefined,
): ColorEffectNode['params'] => ({
  velocities: Array.isArray(params?.velocities)
    ? [...params.velocities]
    : [...DEFAULT_COLOR_PARAMS.velocities],
  noteLengthPercent: typeof params?.noteLengthPercent === 'number'
    ? params.noteLengthPercent
    : DEFAULT_COLOR_PARAMS.noteLengthPercent,
  gapPercent: sanitizeColorGapPercent(params?.gapPercent),
});

export const colorDeviceSchema = {
  kind: 'color',
  label: 'Color',
  group: 'effect',
  numericParamKeys: COLOR_NUMERIC_PARAM_KEYS,
  createDefaultNode: createDefaultColorNode,
  hydrateImportedNode: hydrateImportedColorNode,
} satisfies RendererDeviceSchema<'color'>;
