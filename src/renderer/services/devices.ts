import {
  createDefaultDeviceNode,
  DEVICE_KIND_GROUPS,
  DEVICE_KIND_LABELS,
  DEVICE_KINDS,
  getDeviceGroup,
  getDeviceLabel,
  isDeviceKind,
  type DeviceGroup,
  type DeviceKind,
} from '../../shared/device-registry';
import type { GeneratorDeviceNode } from '../../shared/types';

export {
  SCANNER_PARAM_KEYS,
  SPIRAL_PARAM_KEYS,
  WATERDROP_PARAM_KEYS,
} from '../../shared/device-registry';
export type {
  ScannerParamKey,
  SpiralParamKey,
  WaterdropParamKey,
} from '../../shared/device-registry';

const BROWSER_DEVICE_LABELS = DEVICE_KIND_LABELS;
export type BrowserDeviceKind = DeviceKind;
export type BrowserDeviceGroup = DeviceGroup;

const BROWSER_DEVICE_GROUPS = DEVICE_KIND_GROUPS;
const BROWSER_DEVICE_KIND_SET = new Set<BrowserDeviceKind>(DEVICE_KINDS);

export const BROWSER_GENERATORS = BROWSER_DEVICE_GROUPS.generator.map((kind) => ({
  kind,
  label: BROWSER_DEVICE_LABELS[kind],
}));

export const BROWSER_EFFECTS = BROWSER_DEVICE_GROUPS.effect.map((kind) => ({
  kind,
  label: BROWSER_DEVICE_LABELS[kind],
}));

export const getBrowserDeviceLabel = (kind: BrowserDeviceKind): string =>
  getDeviceLabel(kind);

let generatorIdSeed = 1;
let effectIdSeed = 1;

const readSeedSuffix = (
  id: string,
  prefix: 'generator-' | 'effect-',
): number | null => {
  if (!id.startsWith(prefix)) {
    return null;
  }

  const suffix = Number(id.slice(prefix.length));
  if (!Number.isInteger(suffix) || suffix < 1) {
    return null;
  }
  return suffix;
};

const createGeneratedDeviceNode = (
  kind: BrowserDeviceKind,
): GeneratorDeviceNode => {
  const group = getDeviceGroup(kind);
  const id = group === 'generator'
    ? `generator-${generatorIdSeed++}`
    : `effect-${effectIdSeed++}`;
  return createDefaultDeviceNode(kind, id);
};

export const createInitialChainDevices = (): GeneratorDeviceNode[] => [
  createGeneratedDeviceNode('waterdrop'),
];

export const syncDeviceNodeIdSeeds = (
  devices: ReadonlyArray<GeneratorDeviceNode>,
): void => {
  let maxGeneratorSuffix = 0;
  let maxEffectSuffix = 0;

  for (const device of devices) {
    const generatorSuffix = readSeedSuffix(device.id, 'generator-');
    if (generatorSuffix !== null && generatorSuffix > maxGeneratorSuffix) {
      maxGeneratorSuffix = generatorSuffix;
    }

    const effectSuffix = readSeedSuffix(device.id, 'effect-');
    if (effectSuffix !== null && effectSuffix > maxEffectSuffix) {
      maxEffectSuffix = effectSuffix;
    }
  }

  generatorIdSeed = Math.max(generatorIdSeed, maxGeneratorSuffix + 1);
  effectIdSeed = Math.max(effectIdSeed, maxEffectSuffix + 1);
};

export const isBrowserDeviceKind = (
  value: string | undefined,
): value is BrowserDeviceKind => (
  !!value
  && isDeviceKind(value)
  && BROWSER_DEVICE_KIND_SET.has(value as BrowserDeviceKind)
);

export const createDeviceNodeByKind = (
  kind: BrowserDeviceKind,
): GeneratorDeviceNode => createGeneratedDeviceNode(kind);
