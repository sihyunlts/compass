import type { ChainControlDescriptor, ChainControlHandler, ChainDevice } from './shared';
import {
  createDefaultNumericValueResolver,
  createMergeKeyResolver,
  createNumericParamSetter,
  parseFiniteNumber,
  readDatasetParam,
  readRendererNumericParam,
  requireInput,
  requireSelect,
  resolveNumericDatasetParam,
} from './shared';

type WaterdropDevice = Extract<ChainDevice, { kind: 'waterdrop' }>;
type ScannerDevice = Extract<ChainDevice, { kind: 'scanner' }>;
type SpiralDevice = Extract<ChainDevice, { kind: 'spiral' }>;
type CenterPickerDevice = Extract<ChainDevice, { kind: 'waterdrop' | 'spiral' }>;
type AngleDevice = Extract<ChainDevice, { kind: 'scanner' | 'mirror' | 'rotate' }>;
type ColorDevice = Extract<ChainDevice, { kind: 'color' }>;

const DEFAULT_COLOR_SLOT_VELOCITY = 3;
const MIN_COLOR_SLOT_COUNT = 1;
const CENTER_PICKER_PARAM_KEYS = ['centerX', 'centerY'] as const;
const ANGLE_PARAM_KEYS = ['angleDeg'] as const;

const isWaterdropDevice = (device: ChainDevice): device is WaterdropDevice =>
  device.kind === 'waterdrop';

const isScannerDevice = (device: ChainDevice): device is ScannerDevice =>
  device.kind === 'scanner';

const isSpiralDevice = (device: ChainDevice): device is SpiralDevice =>
  device.kind === 'spiral';

const isCenterPickerDevice = (device: ChainDevice): device is CenterPickerDevice =>
  device.kind === 'waterdrop' || device.kind === 'spiral';

const isAngleDevice = (device: ChainDevice): device is AngleDevice =>
  device.kind === 'scanner' || device.kind === 'mirror' || device.kind === 'rotate';

const isColorDevice = (device: ChainDevice): device is ColorDevice =>
  device.kind === 'color';

const handleSetDeviceEnabled = (): ChainControlHandler => (device, target) => {
  const input = requireInput(target);
  if (!input) {
    return false;
  }
  device.enabled = input.checked;
  return true;
};

const handleSetWaterdropParam = (): ChainControlHandler => createNumericParamSetter({
  isKind: isWaterdropDevice,
  readParam: (input) => readRendererNumericParam('waterdrop', input),
  assign: (device, param, value) => {
    (device.params as unknown as Record<string, number>)[param] = value;
  },
});

const handleSetScannerParam = (): ChainControlHandler => createNumericParamSetter({
  isKind: isScannerDevice,
  readParam: (input) => readRendererNumericParam('scanner', input),
  assign: (device, param, value) => {
    (device.params as unknown as Record<string, number>)[param] = value;
  },
});

const handleSetSpiralParam = (): ChainControlHandler => createNumericParamSetter({
  isKind: isSpiralDevice,
  readParam: (input) => readRendererNumericParam('spiral', input),
  assign: (device, param, value) => {
    (device.params as unknown as Record<string, number>)[param] = value;
  },
});

const handleSetCenterPickerParam = (): ChainControlHandler => createNumericParamSetter({
  isKind: isCenterPickerDevice,
  readParam: (input) => readDatasetParam(input, CENTER_PICKER_PARAM_KEYS),
  assign: (device, param, value) => {
    device.params[param] = value;
  },
});

const handleSetAngleParam = (): ChainControlHandler => createNumericParamSetter({
  isKind: isAngleDevice,
  readParam: (input) => readDatasetParam(input, ANGLE_PARAM_KEYS),
  assign: (device, param, value) => {
    device.params[param] = value;
  },
});

const handleSetColorNoteLengthPercent = (): ChainControlHandler => (device, target) => {
  if (!isColorDevice(device)) {
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

  device.params.noteLengthPercent = Math.min(400, Math.max(1, value));
  return true;
};

const handleSetColorSlotCount = (): ChainControlHandler => (device, target) => {
  if (!isColorDevice(device)) {
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

  const nextCount = Math.max(MIN_COLOR_SLOT_COUNT, Math.round(value));
  const currentCount = device.params.velocities.length;
  if (nextCount === currentCount) {
    return false;
  }

  if (nextCount < currentCount) {
    device.params.velocities.length = nextCount;
    return true;
  }

  while (device.params.velocities.length < nextCount) {
    device.params.velocities.push(DEFAULT_COLOR_SLOT_VELOCITY);
  }
  return true;
};

const handleSetSymmetryMode = (): ChainControlHandler => (device, target) => {
  if (device.kind !== 'symmetry') {
    return false;
  }

  const select = requireSelect(target);
  if (!select) {
    return false;
  }

  const mode = select.value;
  device.params.mode = mode === 'quad-mirror'
    || mode === 'quad-pinwheel'
    || mode === 'mirror-half'
    ? mode
    : 'mirror-half';
  return true;
};

const handleSetSymmetryAxis = (): ChainControlHandler => (device, target) => {
  if (device.kind !== 'symmetry') {
    return false;
  }

  const select = requireSelect(target);
  if (!select) {
    return false;
  }

  device.params.axis = select.value === 'vertical' ? 'vertical' : 'horizontal';
  return true;
};

const handleSetSymmetryAnchor = (): ChainControlHandler => (device, target) => {
  if (device.kind !== 'symmetry') {
    return false;
  }

  const select = requireSelect(target);
  if (!select) {
    return false;
  }

  const anchor = select.value;
  device.params.sourceAnchor = anchor === 'br' || anchor === 'tr' || anchor === 'tl' ? anchor : 'bl';
  return true;
};

export const DEVICE_CONTROL_DESCRIPTORS: Record<string, ChainControlDescriptor> = {
  'set-device-enabled': {
    resolveMergeKey: createMergeKeyResolver('set-device-enabled'),
  },
  'set-waterdrop-param': {
    resolveMergeKey: createMergeKeyResolver('set-waterdrop-param', resolveNumericDatasetParam),
    resolveDefaultValue: createDefaultNumericValueResolver(
      (input) => readRendererNumericParam('waterdrop', input),
    ),
  },
  'set-scanner-param': {
    resolveMergeKey: createMergeKeyResolver('set-scanner-param', resolveNumericDatasetParam),
    resolveDefaultValue: createDefaultNumericValueResolver(
      (input) => readRendererNumericParam('scanner', input),
    ),
  },
  'set-spiral-param': {
    resolveMergeKey: createMergeKeyResolver('set-spiral-param', resolveNumericDatasetParam),
    resolveDefaultValue: createDefaultNumericValueResolver(
      (input) => readRendererNumericParam('spiral', input),
    ),
  },
  'set-center-picker-param': {
    resolveMergeKey: createMergeKeyResolver('set-center-picker-param', resolveNumericDatasetParam),
    resolveDefaultValue: createDefaultNumericValueResolver(
      (input) => readDatasetParam(input, CENTER_PICKER_PARAM_KEYS),
    ),
  },
  'set-angle-param': {
    resolveMergeKey: createMergeKeyResolver('set-angle-param', resolveNumericDatasetParam),
    resolveDefaultValue: createDefaultNumericValueResolver(
      (input) => readDatasetParam(input, ANGLE_PARAM_KEYS),
    ),
  },
  'set-color-note-length-percent': {
    resolveMergeKey: createMergeKeyResolver('set-color-note-length-percent'),
    resolveDefaultValue: (defaultDevice) =>
      defaultDevice.kind === 'color'
        ? defaultDevice.params.noteLengthPercent
        : null,
  },
  'set-color-slot-count': {
    resolveMergeKey: createMergeKeyResolver('set-color-slot-count'),
    resolveDefaultValue: (defaultDevice) =>
      defaultDevice.kind === 'color'
        ? defaultDevice.params.velocities.length
        : null,
  },
  'set-effect-symmetry-mode': {
    resolveMergeKey: createMergeKeyResolver('set-effect-symmetry-mode'),
  },
  'set-effect-symmetry-axis': {
    resolveMergeKey: createMergeKeyResolver('set-effect-symmetry-axis'),
  },
  'set-effect-symmetry-anchor': {
    resolveMergeKey: createMergeKeyResolver('set-effect-symmetry-anchor'),
  },
};

export const createDeviceControlHandlers = (): Record<string, ChainControlHandler> => ({
  'set-device-enabled': handleSetDeviceEnabled(),
  'set-waterdrop-param': handleSetWaterdropParam(),
  'set-scanner-param': handleSetScannerParam(),
  'set-spiral-param': handleSetSpiralParam(),
  'set-center-picker-param': handleSetCenterPickerParam(),
  'set-angle-param': handleSetAngleParam(),
  'set-color-note-length-percent': handleSetColorNoteLengthPercent(),
  'set-color-slot-count': handleSetColorSlotCount(),
  'set-effect-symmetry-mode': handleSetSymmetryMode(),
  'set-effect-symmetry-axis': handleSetSymmetryAxis(),
  'set-effect-symmetry-anchor': handleSetSymmetryAnchor(),
});
