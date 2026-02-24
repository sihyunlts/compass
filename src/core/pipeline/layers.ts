import type {
  GeneratorChain,
  GeneratorDeviceNode,
  GeneratorNode,
  MaskEffectNode,
} from '../../shared/types';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import type { Bounds, GeneratorLayer } from '../core-types';
import {
  IDENTITY_AFFINE,
  mapBoundsThroughAffine,
} from '../geometry';
import { applyMaskEffect } from '../effects/mask';
import { applyMirrorEffect } from '../effects/mirror';
import { applyReverseEffect } from '../effects/reverse';
import { applyRotateEffect } from '../effects/rotate';
import { applySymmetryEffect } from '../effects/symmetry';
import { GENERATED_VELOCITY } from './constants';
import { isEffectNode, isGeneratorNode } from './groups';

type MaskTileResolver = (
  effect: MaskEffectNode,
  deviceIndex: number,
) => Iterable<number> | null;

export const createLayerFromGenerator = (
  device: GeneratorNode,
  worldBounds: Bounds,
): GeneratorLayer | null => {
  const inverseSpatial = IDENTITY_AFFINE;

  if (device.kind === 'waterdrop') {
    const params = device.params;
    if (!Number.isFinite(params.centerX)
      || !Number.isFinite(params.centerY)
      || !Number.isFinite(params.curvature)
      || !Number.isFinite(params.startRadius)) {
      return null;
    }
    return {
      originId: device.id,
      kind: 'waterdrop',
      params,
      spatial: IDENTITY_AFFINE,
      inverseSpatial,
      sourceBounds: mapBoundsThroughAffine(worldBounds, inverseSpatial),
      temporal: { alpha: 1, beta: 0 },
      velocity: GENERATED_VELOCITY,
    };
  }

  if (device.kind === 'scanner') {
    const params = device.params;
    if (!Number.isFinite(params.angleDeg) || !Number.isFinite(params.startOffset)) {
      return null;
    }
    return {
      originId: device.id,
      kind: 'scanner',
      params,
      spatial: IDENTITY_AFFINE,
      inverseSpatial,
      sourceBounds: mapBoundsThroughAffine(worldBounds, inverseSpatial),
      temporal: { alpha: 1, beta: 0 },
      velocity: GENERATED_VELOCITY,
    };
  }

  if (device.kind === 'spiral') {
    const params = device.params;
    if (!Number.isFinite(params.centerX)
      || !Number.isFinite(params.centerY)
      || !Number.isFinite(params.turns)
      || !Number.isFinite(params.startRadius)) {
      return null;
    }
    return {
      originId: device.id,
      kind: 'spiral',
      params,
      spatial: IDENTITY_AFFINE,
      inverseSpatial,
      sourceBounds: mapBoundsThroughAffine(worldBounds, inverseSpatial),
      temporal: { alpha: 1, beta: 0 },
      velocity: GENERATED_VELOCITY,
    };
  }

  return null;
};

export const buildLayers = (
  chain: GeneratorChain,
  worldBounds: Bounds,
  resolveMaskTiles?: MaskTileResolver,
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

    if (device.kind === 'mirror') {
      layers = applyMirrorEffect(layers, device, worldBounds);
      continue;
    }

    if (device.kind === 'mask') {
      const tilesOverride = resolveMaskTiles ? resolveMaskTiles(device, index) : null;
      layers = applyMaskEffect(layers, device, tilesOverride);
      continue;
    }

    if (device.kind === 'rotate') {
      layers = applyRotateEffect(layers, device, worldBounds);
      continue;
    }

    if (device.kind === 'symmetry') {
      layers = applySymmetryEffect(layers, device, worldBounds);
      continue;
    }

    if (device.kind === 'reverse') {
      layers = applyReverseEffect(layers);
    }
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
    if (device.kind === 'reverse' && isDeviceEffectivelyEnabled(chain, device)) {
      parity = !parity;
    }
  }

  return parityAfter;
};
