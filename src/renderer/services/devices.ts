import {
  createRendererDeviceNode,
  getRendererDeviceGroup,
  getRendererDeviceLabel,
  isRendererDeviceKind,
  RENDERER_DEVICE_GROUPS,
  RENDERER_DEVICE_KINDS,
} from '../../devices';
import type { RendererDeviceGroup, RendererDeviceKind } from '../../devices';
import type { GeneratorDeviceNode } from '../../shared/model';

export type BrowserDeviceKind = RendererDeviceKind;
export type BrowserDeviceGroup = RendererDeviceGroup;

export const BROWSER_GENERATORS = RENDERER_DEVICE_GROUPS.generator.map((kind) => ({
  kind,
  label: getRendererDeviceLabel(kind),
}));

export const BROWSER_EFFECTS = RENDERER_DEVICE_GROUPS.effect.map((kind) => ({
  kind,
  label: getRendererDeviceLabel(kind),
}));

export const getBrowserDeviceLabel = (kind: BrowserDeviceKind): string =>
  getRendererDeviceLabel(kind);

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
  const group = getRendererDeviceGroup(kind);
  const id = group === 'generator'
    ? `generator-${generatorIdSeed++}`
    : `effect-${effectIdSeed++}`;
  return createRendererDeviceNode(kind, id);
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
  && isRendererDeviceKind(value)
  && RENDERER_DEVICE_KINDS.includes(value as BrowserDeviceKind)
);

export const createDeviceNodeByKind = (
  kind: BrowserDeviceKind,
): GeneratorDeviceNode => createGeneratedDeviceNode(kind);
