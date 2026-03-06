import {
  SCANNER_PARAM_KEYS,
  SPIRAL_PARAM_KEYS,
  WATERDROP_PARAM_KEYS,
} from '../../../services/devices';
import { getRendererModulationTargetParamDefinitions } from '../../../../devices/metadata';
import {
  createDefaultDeviceNode,
} from '../../../../shared/device-registry';
import { sanitizeCurveDivisions, sanitizeCurveNodes } from '../../../../core/modulation/curve';
import { sanitizeModulationTarget } from '../../../../core/modulation/routing';
import type { GeneratorChain } from '../../../../shared/model';

type ChainDevice = GeneratorChain['devices'][number];
type ChainControlTarget = HTMLInputElement | HTMLSelectElement;
type ChainControlHandler = (device: ChainDevice, target: ChainControlTarget) => boolean;
type WaterdropDevice = Extract<ChainDevice, { kind: 'waterdrop' }>;
type ScannerDevice = Extract<ChainDevice, { kind: 'scanner' }>;
type SpiralDevice = Extract<ChainDevice, { kind: 'spiral' }>;
type CenterPickerDevice = Extract<ChainDevice, { kind: 'waterdrop' | 'spiral' }>;
type AngleDevice = Extract<ChainDevice, { kind: 'scanner' | 'mirror' | 'rotate' }>;
type ColorDevice = Extract<ChainDevice, { kind: 'color' }>;

const DEFAULT_COLOR_SLOT_VELOCITY = 3;
const MIN_COLOR_SLOT_COUNT = 1;

interface ChainControlContext {
  findDeviceById: (id: string) => ChainDevice | null;
  getMaskSourceGroupIds: () => string[];
  getMaskSourceGeneratorIds: () => string[];
}

interface ModulationHandlerContext {
  findDeviceById: (id: string) => ChainDevice | null;
}

interface ChainControlDescriptor {
  resolveMergeKey: (control: ChainControlTarget) => string | null;
  resolveDefaultParamKey?: (input: HTMLInputElement) => string | null;
}

const requireInput = (target: ChainControlTarget): HTMLInputElement | null =>
  target instanceof HTMLInputElement ? target : null;

const requireSelect = (target: ChainControlTarget): HTMLSelectElement | null =>
  target instanceof HTMLSelectElement ? target : null;

const parseFiniteNumber = (raw: string): number | null => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const readDatasetParam = <ParamKey extends string>(
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

const createMergeKeyResolver = (
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

const resolveNumericDatasetParam = (control: ChainControlTarget): string | null =>
  control instanceof HTMLInputElement ? control.dataset.param ?? null : null;

const createNumericParamSetter = <Device extends ChainDevice, ParamKey extends string>(
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

const CENTER_PICKER_PARAM_KEYS = ['centerX', 'centerY'] as const;
const ANGLE_PARAM_KEYS = ['angleDeg'] as const;

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
  readParam: (input) => readDatasetParam(input, WATERDROP_PARAM_KEYS),
  assign: (device, param, value) => {
    device.params[param] = value;
  },
});

const handleSetScannerParam = (): ChainControlHandler => createNumericParamSetter({
  isKind: isScannerDevice,
  readParam: (input) => readDatasetParam(input, SCANNER_PARAM_KEYS),
  assign: (device, param, value) => {
    device.params[param] = value;
  },
});

const handleSetSpiralParam = (): ChainControlHandler => createNumericParamSetter({
  isKind: isSpiralDevice,
  readParam: (input) => readDatasetParam(input, SPIRAL_PARAM_KEYS),
  assign: (device, param, value) => {
    device.params[param] = value;
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

const handleSetMaskMode = (): ChainControlHandler => (device, target) => {
  if (device.kind !== 'mask') {
    return false;
  }

  const select = requireSelect(target);
  if (!select) {
    return false;
  }

  device.params.mode = select.value === 'exclude' ? 'exclude' : 'include';
  return true;
};

const handleSetMaskSourceVisibility = (): ChainControlHandler => (device, target) => {
  if (device.kind !== 'mask') {
    return false;
  }

  const select = requireSelect(target);
  if (!select) {
    return false;
  }

  device.params.sourceVisibility = select.value === 'show' ? 'show' : 'hide';
  return true;
};

const handleSetMaskSourceKind = (context: ChainControlContext): ChainControlHandler => (device, target) => {
  if (device.kind !== 'mask') {
    return false;
  }

  const select = requireSelect(target);
  if (!select) {
    return false;
  }

  const nextKind = select.value === 'group'
    || select.value === 'generator'
    || select.value === 'tiles'
    ? select.value
    : 'tiles';
  device.params.sourceKind = nextKind;

  if (nextKind === 'tiles') {
    device.params.sourceId = null;
    return true;
  }

  const options = nextKind === 'group'
    ? context.getMaskSourceGroupIds()
    : context.getMaskSourceGeneratorIds();
  if (!options.includes(device.params.sourceId ?? '')) {
    device.params.sourceId = options[0] ?? null;
  }
  return true;
};

const handleSetMaskSourceId = (context: ChainControlContext): ChainControlHandler => (device, target) => {
  if (device.kind !== 'mask') {
    return false;
  }

  const select = requireSelect(target);
  if (!select) {
    return false;
  }

  const rawId = select.value.trim();
  if (!rawId) {
    device.params.sourceId = null;
    return true;
  }

  if (device.params.sourceKind === 'group') {
    device.params.sourceId = context.getMaskSourceGroupIds().includes(rawId)
      ? rawId
      : null;
    return true;
  }

  if (device.params.sourceKind === 'generator') {
    device.params.sourceId = context.getMaskSourceGeneratorIds().includes(rawId)
      ? rawId
      : null;
    return true;
  }

  device.params.sourceId = null;
  return true;
};

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

const createModulationControlHandlers = (
  context: ModulationHandlerContext,
): Record<string, ChainControlHandler> => ({
  'set-modulation-target-device': handleSetModulationTargetDevice(context),
  'set-modulation-target-param': handleSetModulationTargetParam(),
  'set-modulation-amount': handleSetModulationAmount(),
  'set-modulation-divisions': handleSetModulationDivisions(),
  'set-modulation-curve-nodes': handleSetModulationCurveNodes(),
});

const CHAIN_CONTROL_DESCRIPTORS: Record<string, ChainControlDescriptor> = {
  'set-device-enabled': {
    resolveMergeKey: createMergeKeyResolver('set-device-enabled'),
  },
  'set-waterdrop-param': {
    resolveMergeKey: createMergeKeyResolver('set-waterdrop-param', resolveNumericDatasetParam),
    resolveDefaultParamKey: (input) => input.dataset.param ?? null,
  },
  'set-scanner-param': {
    resolveMergeKey: createMergeKeyResolver('set-scanner-param', resolveNumericDatasetParam),
    resolveDefaultParamKey: (input) => input.dataset.param ?? null,
  },
  'set-spiral-param': {
    resolveMergeKey: createMergeKeyResolver('set-spiral-param', resolveNumericDatasetParam),
    resolveDefaultParamKey: (input) => input.dataset.param ?? null,
  },
  'set-center-picker-param': {
    resolveMergeKey: createMergeKeyResolver('set-center-picker-param', resolveNumericDatasetParam),
    resolveDefaultParamKey: (input) => input.dataset.param ?? null,
  },
  'set-angle-param': {
    resolveMergeKey: createMergeKeyResolver('set-angle-param', resolveNumericDatasetParam),
    resolveDefaultParamKey: (input) => input.dataset.param ?? null,
  },
  'set-color-note-length-percent': {
    resolveMergeKey: createMergeKeyResolver('set-color-note-length-percent'),
    resolveDefaultParamKey: () => 'noteLengthPercent',
  },
  'set-color-slot-count': {
    resolveMergeKey: createMergeKeyResolver('set-color-slot-count'),
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
  'set-mask-mode': {
    resolveMergeKey: createMergeKeyResolver('set-mask-mode'),
  },
  'set-mask-source-visibility': {
    resolveMergeKey: createMergeKeyResolver('set-mask-source-visibility'),
  },
  'set-mask-source-kind': {
    resolveMergeKey: createMergeKeyResolver('set-mask-source-kind'),
  },
  'set-mask-source-id': {
    resolveMergeKey: createMergeKeyResolver('set-mask-source-id'),
  },
  'set-modulation-target-device': {
    resolveMergeKey: createMergeKeyResolver('set-modulation-target-device'),
  },
  'set-modulation-target-param': {
    resolveMergeKey: createMergeKeyResolver('set-modulation-target-param'),
  },
  'set-modulation-amount': {
    resolveMergeKey: createMergeKeyResolver('set-modulation-amount'),
    resolveDefaultParamKey: () => 'amount',
  },
  'set-modulation-divisions': {
    resolveMergeKey: createMergeKeyResolver('set-modulation-divisions'),
  },
  'set-modulation-curve-nodes': {
    resolveMergeKey: createMergeKeyResolver('set-modulation-curve-nodes'),
  },
};

export const createChainControlHandlers = (
  context: ChainControlContext,
): Record<string, ChainControlHandler> => ({
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
  'set-mask-mode': handleSetMaskMode(),
  'set-mask-source-visibility': handleSetMaskSourceVisibility(),
  'set-mask-source-kind': handleSetMaskSourceKind(context),
  'set-mask-source-id': handleSetMaskSourceId(context),
  ...createModulationControlHandlers({
    findDeviceById: context.findDeviceById,
  }),
});

const getControlTarget = (target: EventTarget | null): ChainControlTarget | null => {
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
    return target;
  }
  return null;
};

const resolveControlDescriptor = (
  control: ChainControlTarget,
): ChainControlDescriptor | null => {
  const action = control.dataset.action;
  if (!action) {
    return null;
  }
  return CHAIN_CONTROL_DESCRIPTORS[action] ?? null;
};

export const applyChainControlChange = (
  target: EventTarget | null,
  findDeviceById: (id: string) => ChainDevice | null,
  chainControlHandlers: Readonly<Record<string, ChainControlHandler>>,
): boolean => {
  const control = getControlTarget(target);
  if (!control) {
    return false;
  }

  const action = control.dataset.action;
  const id = control.dataset.id;
  if (!action || !id) {
    return false;
  }

  const device = findDeviceById(id);
  if (!device) {
    return false;
  }

  const handler = chainControlHandlers[action];
  return handler ? handler(device, control) : false;
};

export const resolveChainControlMergeKey = (
  target: EventTarget | null,
): string | null => {
  const control = getControlTarget(target);
  if (!control) {
    return null;
  }

  const descriptor = resolveControlDescriptor(control);
  return descriptor?.resolveMergeKey(control) ?? null;
};

export const resetNumericControlToDefault = (
  target: EventTarget | null,
  findDeviceById: (id: string) => ChainDevice | null,
  chainControlHandlers: Readonly<Record<string, ChainControlHandler>>,
): boolean => {
  if (!(target instanceof HTMLInputElement) || target.type !== 'number') {
    return false;
  }

  const action = target.dataset.action;
  const id = target.dataset.id;
  const descriptor = resolveControlDescriptor(target);
  if (!action || !id || !descriptor || !chainControlHandlers[action]) {
    return false;
  }

  const paramKey = descriptor.resolveDefaultParamKey?.(target) ?? null;
  if (!paramKey) {
    return false;
  }

  const device = findDeviceById(id);
  if (!device) {
    return false;
  }

  const defaultDevice = createDefaultDeviceNode(device.kind, device.id, device.enabled);
  if (!('params' in defaultDevice)) {
    return false;
  }

  const defaultValue = (defaultDevice.params as Record<string, unknown>)[paramKey];
  if (typeof defaultValue !== 'number' || !Number.isFinite(defaultValue)) {
    return false;
  }

  const currentValue = Number(target.value);
  if (Number.isFinite(currentValue) && Math.abs(currentValue - defaultValue) < 0.0001) {
    return false;
  }

  target.value = String(defaultValue);
  target.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
};
