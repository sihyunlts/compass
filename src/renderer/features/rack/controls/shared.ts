import { getRendererNumericParamKeys } from '../../../../devices';
import type { GeneratorChain } from '../../../../shared/model';

export type ChainDevice = GeneratorChain['devices'][number];
export type ChainControlTarget = HTMLInputElement | HTMLSelectElement;
export type ChainControlHandler = (device: ChainDevice, target: ChainControlTarget) => boolean;

export interface ChainControlContext {
  findDeviceById: (id: string) => ChainDevice | null;
  getMaskSourceGroupIds: () => string[];
  getMaskSourceGeneratorIds: () => string[];
}

export interface ModulationHandlerContext {
  findDeviceById: (id: string) => ChainDevice | null;
}

export interface ChainControlDescriptor {
  resolveMergeKey: (control: ChainControlTarget) => string | null;
  resolveDefaultValue?: (
    defaultDevice: ChainDevice,
    input: HTMLInputElement,
  ) => number | null;
}

export const requireInput = (target: ChainControlTarget): HTMLInputElement | null =>
  target instanceof HTMLInputElement ? target : null;

export const requireSelect = (target: ChainControlTarget): HTMLSelectElement | null =>
  target instanceof HTMLSelectElement ? target : null;

export const parseFiniteNumber = (raw: string): number | null => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

export const readDatasetParam = <ParamKey extends string>(
  input: HTMLInputElement,
  allowedParamKeys: readonly ParamKey[],
): ParamKey | null => {
  const rawParam = input.dataset.param;
  if (!rawParam || !allowedParamKeys.includes(rawParam as ParamKey)) {
    return null;
  }
  return rawParam as ParamKey;
};

const resolveControlDeviceId = (control: ChainControlTarget): string | null => {
  const id = control.dataset.id?.trim();
  return id ? id : null;
};

export const createMergeKeyResolver = (
  action: string,
  resolveParamKey?: (control: ChainControlTarget) => string | null,
) => (control: ChainControlTarget): string | null => {
  const id = resolveControlDeviceId(control);
  if (!id) {
    return null;
  }

  const paramKey = resolveParamKey?.(control);
  return paramKey
    ? `control|${action}|${id}|${paramKey}`
    : `control|${action}|${id}`;
};

export const resolveNumericDatasetParam = (control: ChainControlTarget): string | null =>
  control instanceof HTMLInputElement ? control.dataset.param ?? null : null;

export const readRendererNumericParam = (
  kind: ChainDevice['kind'],
  input: HTMLInputElement,
): string | null => readDatasetParam(input, getRendererNumericParamKeys(kind));

const readNumericValueFromDeviceParams = (
  device: ChainDevice,
  paramKey: string,
): number | null => {
  if (!('params' in device)) {
    return null;
  }

  const value = (device.params as Record<string, unknown>)[paramKey];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

export const createDefaultNumericValueResolver = (
  resolveParamKey: (input: HTMLInputElement) => string | null,
) => (
  defaultDevice: ChainDevice,
  input: HTMLInputElement,
): number | null => {
  const paramKey = resolveParamKey(input);
  if (!paramKey) {
    return null;
  }

  return readNumericValueFromDeviceParams(defaultDevice, paramKey);
};

export const createNumericParamSetter = <Device extends ChainDevice, ParamKey extends string>(
  options: {
    isKind: (device: ChainDevice) => device is Device;
    readParam: (input: HTMLInputElement) => ParamKey | null;
    assign: (device: Device, param: ParamKey, value: number) => void;
  },
): ChainControlHandler => (device, target) => {
  if (!options.isKind(device)) {
    return false;
  }

  const input = requireInput(target);
  if (!input) {
    return false;
  }

  const param = options.readParam(input);
  if (!param) {
    return false;
  }

  const value = parseFiniteNumber(input.value);
  if (value === null) {
    return false;
  }

  options.assign(device, param, value);
  return true;
};

export const getControlTarget = (target: EventTarget | null): ChainControlTarget | null => {
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
    return target;
  }
  return null;
};
