import { GENERATED_VELOCITY } from '../../core/pipeline/constants';
import { buildWaterdropPolyline } from '../../core/generators/waterdrop';
import { createGeneratorLayerBase, resolveLayerLocalTime } from '../engine-utils';
import type { GeneratorDeviceEngineHandler } from '../engine-types';

export const waterdropEngineHandler = {
  kind: 'waterdrop',
  createLayer(device, worldBounds) {
    const params = device.params;
    if (!Number.isFinite(params.centerX)
      || !Number.isFinite(params.centerY)
      || !Number.isFinite(params.curvature)
      || !Number.isFinite(params.startRadius)) {
      return null;
    }

    return {
      ...createGeneratorLayerBase(device.id, worldBounds),
      kind: 'waterdrop',
      params,
      velocity: GENERATED_VELOCITY,
    };
  },
  buildPolyline(layer, t01, step) {
    const localT = resolveLayerLocalTime(layer, t01);
    if (localT === null) {
      return null;
    }

    return buildWaterdropPolyline(
      layer.originId,
      layer.params,
      localT,
      step,
      layer.velocity,
    );
  },
} satisfies GeneratorDeviceEngineHandler<'waterdrop'>;
