import type { ColorEffectNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
  toIntegerArray,
} from '../import-hydration';
import {
  boundedNumericParameter,
  defineNumericParameterRules,
  hydrateImportedNumericParameters,
  normalizeNumericParameterValue,
} from '../numeric-parameters';
import type { RendererDeviceSchema } from '../types';

const MAX_COLOR_PERCENT = 400;

export const DEFAULT_COLOR_PARAMS: ColorEffectNode['params'] = {
  velocities: [3],
  noteLengthPercent: 100,
  gapPercent: 0,
};

export const COLOR_NUMERIC_PARAMETERS = defineNumericParameterRules<
  ColorEffectNode['params']
>()({
  noteLengthPercent: boundedNumericParameter({
    defaultValue: DEFAULT_COLOR_PARAMS.noteLengthPercent,
    min: 1,
    max: MAX_COLOR_PERCENT,
    step: 1,
    display: { unit: '%' },
  }),
  gapPercent: boundedNumericParameter({
    defaultValue: DEFAULT_COLOR_PARAMS.gapPercent,
    min: 0,
    max: MAX_COLOR_PERCENT,
    step: 1,
    display: { unit: '%' },
  }),
});

const createDefaultColorNode = (
  id: string,
  enabled: boolean,
): ColorEffectNode => ({
  id,
  kind: 'color',
  enabled,
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
    noteLengthPercent: device.params.noteLengthPercent,
    gapPercent: device.params.gapPercent,
  };
  hydrateImportedNumericParameters(device.params, params, COLOR_NUMERIC_PARAMETERS);
  if (device.params.velocities.length === 0) {
    device.params.velocities = [...DEFAULT_COLOR_PARAMS.velocities];
  }
  return device;
};

export const sanitizeColorGapPercent = (value: unknown): number => {
  const normalized = normalizeNumericParameterValue(
    COLOR_NUMERIC_PARAMETERS.gapPercent,
    value,
    DEFAULT_COLOR_PARAMS,
  );
  return normalized ?? DEFAULT_COLOR_PARAMS.gapPercent;
};

export const normalizeColorDeviceParams = (
  params: Partial<ColorEffectNode['params']> | null | undefined,
): ColorEffectNode['params'] => {
  const normalized: ColorEffectNode['params'] = {
    velocities: Array.isArray(params?.velocities)
    ? [...params.velocities]
    : [...DEFAULT_COLOR_PARAMS.velocities],
    noteLengthPercent: DEFAULT_COLOR_PARAMS.noteLengthPercent,
    gapPercent: DEFAULT_COLOR_PARAMS.gapPercent,
  };
  hydrateImportedNumericParameters(
    normalized,
    params ?? {},
    COLOR_NUMERIC_PARAMETERS,
  );
  return normalized;
};

export const colorDeviceSchema = {
  kind: 'color',
  label: 'Color',
  group: 'effect',
  numericParameters: COLOR_NUMERIC_PARAMETERS,
  createDefaultNode: createDefaultColorNode,
  hydrateImportedNode: hydrateImportedColorNode,
} satisfies RendererDeviceSchema<'color'>;
