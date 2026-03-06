import type { GeneratorDeviceNode } from '../shared/model';
import type { RendererControlHandler, RendererControlTarget } from './control-types';

export const requireInput = (target: RendererControlTarget): HTMLInputElement | null =>
  target instanceof HTMLInputElement ? target : null;

export const requireSelect = (target: RendererControlTarget): HTMLSelectElement | null =>
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

const resolveControlDeviceId = (control: RendererControlTarget): string | null => {
  const id = control.dataset.id?.trim();
  return id ? id : null;
};

export const createMergeKeyResolver = (
  action: string,
  resolveParamKey?: (control: RendererControlTarget) => string | null,
) => (control: RendererControlTarget): string | null => {
  const id = resolveControlDeviceId(control);
  if (!id) {
    return null;
  }

  const paramKey = resolveParamKey?.(control);
  return paramKey
    ? `control|${action}|${id}|${paramKey}`
    : `control|${action}|${id}`;
};

export const resolveNumericDatasetParam = (
  control: RendererControlTarget,
): string | null =>
  control instanceof HTMLInputElement ? control.dataset.param ?? null : null;

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
  resolveParamKey: (input: HTMLInputElement) => string | null,
) => (
  defaultDevice: GeneratorDeviceNode,
  input: HTMLInputElement,
): number | null => {
  const paramKey = resolveParamKey(input);
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
    readParam: (input: HTMLInputElement) => ParamKey | null;
    assign: (device: Device, param: ParamKey, value: number) => void;
  },
): RendererControlHandler => (device, target) => {
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

export const getControlTarget = (target: EventTarget | null): RendererControlTarget | null => {
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
    return target;
  }
  return null;
};
