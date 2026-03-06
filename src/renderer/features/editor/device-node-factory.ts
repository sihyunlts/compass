import {
  createRendererDeviceNode,
  getRendererDeviceGroup,
} from '../../../devices';
import type { RendererDeviceKind } from '../../../devices';
import type { GeneratorDeviceNode } from '../../../shared/model';

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
  kind: RendererDeviceKind,
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

export const createDeviceNodeByKind = (
  kind: RendererDeviceKind,
): GeneratorDeviceNode => createGeneratedDeviceNode(kind);
