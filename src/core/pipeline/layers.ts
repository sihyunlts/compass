import {
  applyPipelineEffect,
  createGeneratorLayer,
  doesDeviceToggleTimelineParity,
  type EffectApplicationContext,
  type PipelineEffectNode,
} from '../../devices/engine';
import type { GeneratorChain, GeneratorDeviceNode, GeneratorNode } from '../../shared/model';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import type { Bounds, GeneratorLayer } from '../core-types';
import { isEffectNode, isGeneratorNode } from './groups';

type EffectContextResolver = (
  effect: PipelineEffectNode,
  deviceIndex: number,
) => Omit<EffectApplicationContext, 'worldBounds'> | null;

export const createLayerFromGenerator = (
  device: GeneratorNode,
  worldBounds: Bounds,
): GeneratorLayer | null => createGeneratorLayer(device, worldBounds);

export const buildLayers = (
  chain: GeneratorChain,
  worldBounds: Bounds,
  resolveEffectContext?: EffectContextResolver,
): GeneratorLayer[] => {
  let layers: GeneratorLayer[] = [];

  for (let index = 0; index < chain.devices.length; index += 1) {
    const device = chain.devices[index];
    if (!isDeviceEffectivelyEnabled(chain, device)) {
      continue;
    }

    if (isGeneratorNode(device)) {
      const layer = createLayerFromGenerator(device, worldBounds);
      if (layer) {
        layers.push(layer);
      }
      continue;
    }

    if (!isEffectNode(device)) {
      continue;
    }

    const effectContext = resolveEffectContext?.(device, index);
    layers = applyPipelineEffect(layers, device, {
      worldBounds,
      tilesOverride: effectContext?.tilesOverride ?? null,
    });
  }

  return layers;
};

export const resolveReverseParityAfter = (
  chain: GeneratorChain,
  devices: ReadonlyArray<GeneratorDeviceNode>,
): boolean[] => {
  const parityAfter: boolean[] = new Array(devices.length).fill(false);
  let parity = false;

  for (let index = devices.length - 1; index >= 0; index -= 1) {
    parityAfter[index] = parity;
    const device = devices[index];
    if (doesDeviceToggleTimelineParity(device) && isDeviceEffectivelyEnabled(chain, device)) {
      parity = !parity;
    }
  }

  return parityAfter;
};
