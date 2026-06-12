import type { GeneratorDeviceNode } from '../shared/model';
import type {
  RendererControlChange,
  RendererControlHandler,
} from './control-types';

export const parseFiniteControlNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

const readNumericValueFromDeviceParams = (
  device: GeneratorDeviceNode,
  paramKey: string,
): number | null => {
  if (!('params' in device)) {
    return null;
  }

  const value = (device.params as Record<string, unknown>)[paramKey];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

export const createDefaultNumericValueResolver = (
  resolveParamKey: (change: RendererControlChange) => string | null,
) => (
  defaultDevice: GeneratorDeviceNode,
  change: RendererControlChange,
): number | null => {
  const paramKey = resolveParamKey(change);
  if (!paramKey) {
    return null;
  }

  return readNumericValueFromDeviceParams(defaultDevice, paramKey);
};

export const createNumericParamSetter = <
  Device extends GeneratorDeviceNode,
  ParamKey extends string,
>(
  options: {
    isKind: (device: GeneratorDeviceNode) => device is Device;
    readParam: (change: RendererControlChange) => ParamKey | null;
    assign: (device: Device, param: ParamKey, value: number, change: RendererControlChange) => void;
  },
): RendererControlHandler => (device, change) => {
  if (!options.isKind(device)) {
    return false;
  }

  const param = options.readParam(change);
  if (!param) {
    return false;
  }

  const value = parseFiniteControlNumber(change.value);
  if (value === null) {
    return false;
  }

  options.assign(device, param, value, change);
  return true;
};
