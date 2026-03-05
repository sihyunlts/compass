import { GENERATED_VELOCITY } from '../../core/pipeline/constants';
import { buildSpiralPolyline } from '../../core/generators/spiral';
import { createGeneratorLayerBase, resolveLayerLocalTime } from '../engine-utils';
import type { GeneratorDeviceEngineHandler } from '../engine-types';

export const spiralEngineHandler = {
  kind: 'spiral',
  createLayer(device, worldBounds) {
    const params = device.params;
    if (!Number.isFinite(params.centerX)
      || !Number.isFinite(params.centerY)
      || !Number.isFinite(params.turns)
      || !Number.isFinite(params.startRadius)) {
      return null;
    }

    return {
      ...createGeneratorLayerBase(device.id, worldBounds),
      kind: 'spiral',
      params,
      velocity: GENERATED_VELOCITY,
    };
  },
  buildPolyline(layer, t01, step) {
    const localT = resolveLayerLocalTime(layer, t01);
    if (localT === null) {
      return null;
    }

    return buildSpiralPolyline(
      layer.originId,
      layer.params,
      localT,
      step,
      layer.velocity,
    );
  },
} satisfies GeneratorDeviceEngineHandler<'spiral'>;
