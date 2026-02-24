import {
  SCANNER_PARAM_KEYS,
  SPIRAL_PARAM_KEYS,
  WATERDROP_PARAM_KEYS,
  type ScannerParamKey,
  type SpiralParamKey,
  type WaterdropParamKey,
} from '../devices';
import {
  getModulationTargetParamDefinitions,
  isModulationTargetDeviceKind,
} from '../../../shared/device-registry';
import { sanitizeCurveDivisions, sanitizeCurveNodes } from '../../../core/modulation/curve';
import { sanitizeModulationTarget } from '../../../core/modulation/routing';
import type { GeneratorChain } from '../../../shared/types';

type ChainDevice = GeneratorChain['devices'][number];
type ChainControlTarget = HTMLInputElement | HTMLSelectElement;
type ChainControlHandler = (device: ChainDevice, target: ChainControlTarget) => boolean;

interface ChainControlContext {
  findDeviceById: (id: string) => ChainDevice | null;
  getMaskSourceGroupIds: () => string[];
  getMaskSourceGeneratorIds: () => string[];
}

interface ModulationHandlerContext {
  findDeviceById: (id: string) => ChainDevice | null;
}

const requireInput = (target: ChainControlTarget): HTMLInputElement | null =>
  target instanceof HTMLInputElement ? target : null;

const requireSelect = (target: ChainControlTarget): HTMLSelectElement | null =>
  target instanceof HTMLSelectElement ? target : null;

const parseFiniteNumber = (raw: string): number | null => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const handleSetDeviceEnabled = (): ChainControlHandler => (device, target) => {
  const input = requireInput(target);
  if (!input) {
    return false;
  }
  device.enabled = input.checked;
  return true;
};

const handleSetWaterdropParam = (): ChainControlHandler => (device, target) => {
  if (device.kind !== 'waterdrop') {
    return false;
  }

  const input = requireInput(target);
  if (!input) {
    return false;
  }

  const rawParam = input.dataset.param;
  if (!rawParam || !WATERDROP_PARAM_KEYS.includes(rawParam as WaterdropParamKey)) {
    return false;
  }

  const value = parseFiniteNumber(input.value);
  if (value === null) {
    return false;
  }

  const param = rawParam as WaterdropParamKey;
  device.params[param] = value;
  return true;
};

const handleSetScannerParam = (): ChainControlHandler => (device, target) => {
  if (device.kind !== 'scanner') {
    return false;
  }

  const input = requireInput(target);
  if (!input) {
    return false;
  }

  const rawParam = input.dataset.param;
  if (!rawParam || !SCANNER_PARAM_KEYS.includes(rawParam as ScannerParamKey)) {
    return false;
  }

  const value = parseFiniteNumber(input.value);
  if (value === null) {
    return false;
  }

  const param = rawParam as ScannerParamKey;
  device.params[param] = value;
  return true;
};

const handleSetSpiralParam = (): ChainControlHandler => (device, target) => {
  if (device.kind !== 'spiral') {
    return false;
  }

  const input = requireInput(target);
  if (!input) {
    return false;
  }

  const rawParam = input.dataset.param;
  if (!rawParam || !SPIRAL_PARAM_KEYS.includes(rawParam as SpiralParamKey)) {
    return false;
  }

  const value = parseFiniteNumber(input.value);
  if (value === null) {
    return false;
  }

  const param = rawParam as SpiralParamKey;
  device.params[param] = value;
  return true;
};

const handleSetAngleParam = (): ChainControlHandler => (device, target) => {
  if (device.kind !== 'scanner' && device.kind !== 'mirror' && device.kind !== 'rotate') {
    return false;
  }

  const input = requireInput(target);
  if (!input) {
    return false;
  }

  if (input.dataset.param !== 'angleDeg') {
    return false;
  }

  const value = parseFiniteNumber(input.value);
  if (value === null) {
    return false;
  }

  device.params.angleDeg = value;
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
  if (!targetDevice || !isModulationTargetDeviceKind(targetDevice.kind)) {
    device.params.target = null;
    return true;
  }

  const paramOptions = getModulationTargetParamDefinitions(targetDevice.kind);
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

export const createChainControlHandlers = (
  context: ChainControlContext,
): Record<string, ChainControlHandler> => ({
  'set-device-enabled': handleSetDeviceEnabled(),
  'set-waterdrop-param': handleSetWaterdropParam(),
  'set-scanner-param': handleSetScannerParam(),
  'set-spiral-param': handleSetSpiralParam(),
  'set-angle-param': handleSetAngleParam(),
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
