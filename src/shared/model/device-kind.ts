import type {
  CurveModulatorNode,
  GeneratorDeviceNode,
  GeneratorNode,
} from './chain';

const GENERATOR_DEVICE_KINDS = new Set<GeneratorDeviceNode['kind']>([
  'waterdrop',
  'scanner',
  'spiral',
  'path',
]);

export const isGeneratorDeviceKind = (
  deviceKind: GeneratorDeviceNode['kind'],
): deviceKind is GeneratorNode['kind'] => GENERATOR_DEVICE_KINDS.has(deviceKind);

export const isGeneratorNode = (
  device: GeneratorDeviceNode,
): device is GeneratorNode => isGeneratorDeviceKind(device.kind);

export const isCurveModulatorNode = (
  device: GeneratorDeviceNode,
): device is CurveModulatorNode => device.kind === 'modulator';
