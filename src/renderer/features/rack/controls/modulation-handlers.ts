import { getRendererModulationTargetParamDefinitions } from '../../../../devices';
import { sanitizeCurveDivisions, sanitizeCurveNodes } from '../../../../core/modulation/curve';
import { sanitizeModulationTarget } from '../../../../core/modulation/routing';
import type {
  ChainControlDescriptor,
  ChainControlHandler,
  ModulationHandlerContext,
} from './shared';
import {
  createMergeKeyResolver,
  parseFiniteNumber,
  requireInput,
  requireSelect,
} from './shared';

const handleSetModulationTargetDevice = (
  context: ModulationHandlerContext,
): ChainControlHandler => (device, target) => {
  if (device.kind !== 'modulator') {
    return false;
  }

  const select = requireSelect(target);
  if (!select) {
    return false;
  }

  const deviceId = select.value.trim();
  if (!deviceId) {
    device.params.target = null;
    return true;
  }

  const targetDevice = context.findDeviceById(deviceId);
  if (!targetDevice) {
    device.params.target = null;
    return true;
  }

  const paramOptions = getRendererModulationTargetParamDefinitions(targetDevice.kind);
  if (paramOptions.length === 0) {
    device.params.target = null;
    return true;
  }

  const currentParamKey = device.params.target?.paramKey ?? '';
  const nextParamKey = paramOptions.some((item) => item.key === currentParamKey)
    ? currentParamKey
    : paramOptions[0].key;

  device.params.target = sanitizeModulationTarget({
    deviceId,
    paramKey: nextParamKey,
  });
  return true;
};

const handleSetModulationTargetParam = (): ChainControlHandler => (device, target) => {
  if (device.kind !== 'modulator') {
    return false;
  }

  const select = requireSelect(target);
  if (!select) {
    return false;
  }

  const paramKey = select.value.trim();
  if (!paramKey) {
    device.params.target = null;
    return true;
  }

  const currentDeviceId = device.params.target?.deviceId ?? '';
  if (!currentDeviceId) {
    return false;
  }

  device.params.target = sanitizeModulationTarget({
    deviceId: currentDeviceId,
    paramKey,
  });
  return true;
};

const handleSetModulationAmount = (): ChainControlHandler => (device, target) => {
  if (device.kind !== 'modulator') {
    return false;
  }

  const input = requireInput(target);
  if (!input) {
    return false;
  }

  const value = parseFiniteNumber(input.value);
  if (value === null) {
    return false;
  }

  device.params.amount = value;
  return true;
};

const handleSetModulationDivisions = (): ChainControlHandler => (device, target) => {
  if (device.kind !== 'modulator') {
    return false;
  }

  const select = requireSelect(target);
  if (!select) {
    return false;
  }

  device.params.curve.divisions = sanitizeCurveDivisions(select.value);
  return true;
};

const handleSetModulationCurveNodes = (): ChainControlHandler => (device, target) => {
  if (device.kind !== 'modulator') {
    return false;
  }

  const input = requireInput(target);
  if (!input) {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.value);
  } catch {
    return false;
  }

  device.params.curve.nodes = sanitizeCurveNodes(parsed);
  return true;
};

export const MODULATION_CONTROL_DESCRIPTORS: Record<string, ChainControlDescriptor> = {
  'set-modulation-target-device': {
    resolveMergeKey: createMergeKeyResolver('set-modulation-target-device'),
  },
  'set-modulation-target-param': {
    resolveMergeKey: createMergeKeyResolver('set-modulation-target-param'),
  },
  'set-modulation-amount': {
    resolveMergeKey: createMergeKeyResolver('set-modulation-amount'),
    resolveDefaultValue: (defaultDevice) =>
      defaultDevice.kind === 'modulator'
        ? defaultDevice.params.amount
        : null,
  },
  'set-modulation-divisions': {
    resolveMergeKey: createMergeKeyResolver('set-modulation-divisions'),
  },
  'set-modulation-curve-nodes': {
    resolveMergeKey: createMergeKeyResolver('set-modulation-curve-nodes'),
  },
};

export const createModulationControlHandlers = (
  context: ModulationHandlerContext,
): Record<string, ChainControlHandler> => ({
  'set-modulation-target-device': handleSetModulationTargetDevice(context),
  'set-modulation-target-param': handleSetModulationTargetParam(),
  'set-modulation-amount': handleSetModulationAmount(),
  'set-modulation-divisions': handleSetModulationDivisions(),
  'set-modulation-curve-nodes': handleSetModulationCurveNodes(),
});
