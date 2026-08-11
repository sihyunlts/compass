import type { GeneratorDeviceNode } from '../shared/model';
import type {
  RendererControlChange,
  RendererControlHandler,
} from './control-types';
import type { NumericParameterRules } from './numeric-parameters';
import {
  parseFiniteNumericParameterValue,
  readNumericParameterKey,
  writeNumericParameterValue,
} from './numeric-parameters';

export const parseFiniteControlNumber = (value: unknown): number | null => {
  return parseFiniteNumericParameterValue(value);
};

export type StructuredControlValueParseResult =
  | { ok: true; value: unknown }
  | { ok: false };

export const parseStructuredControlValue = (
  value: unknown,
): StructuredControlValueParseResult => {
  if (typeof value !== 'string') {
    return { ok: true, value };
  }

  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
};

export const readControlParam = <ParamKey extends string>(
  change: RendererControlChange,
  allowedParamKeys: readonly ParamKey[],
): ParamKey | null => {
  const rawParam = change.paramKey;
  if (!rawParam || !allowedParamKeys.includes(rawParam as ParamKey)) {
    return null;
  }
  return rawParam as ParamKey;
};

export const createMergeKeyResolver = (
  action: string,
  resolveParamKey?: (change: RendererControlChange) => string | null,
) => (change: RendererControlChange): string | null => {
  const id = change.deviceId.trim();
  if (!id) {
    return null;
  }

  const paramKey = resolveParamKey?.(change);
  return paramKey
    ? `control|${action}|${id}|${paramKey}`
    : `control|${action}|${id}`;
};

export const resolveNumericControlParam = (
  change: RendererControlChange,
): string | null => change.paramKey ?? null;

export const createNumericParameterDefaultResolver = <Params extends object>(
  rules: NumericParameterRules<Params>,
  resolveParamKey: (change: RendererControlChange) => string | null,
) => (
  _defaultDevice: GeneratorDeviceNode,
  change: RendererControlChange,
): number | null => {
  const paramKey = resolveParamKey(change);
  const key = readNumericParameterKey(paramKey ?? undefined, rules);
  if (!key) {
    return null;
  }

  return rules[key]?.defaultValue ?? null;
};

export const createNumericParameterSetter = <
  Device extends GeneratorDeviceNode & { params: object },
>(
  options: {
    isKind: (device: GeneratorDeviceNode) => device is Device;
    rules: NumericParameterRules<Device['params']>;
    readParam: (change: RendererControlChange) => string | null;
  },
): RendererControlHandler => (device, change) => {
  if (!options.isKind(device)) {
    return false;
  }

  const param = options.readParam(change);
  if (!param) {
    return false;
  }

  return writeNumericParameterValue(
    device.params,
    options.rules,
    param,
    change.value,
    { step: change.step },
  ) !== null;
};
