import { GENERATED_VELOCITY } from '../../core/pipeline/constants';
import { buildScannerPolyline } from '../../core/generators/scanner';
import { createGeneratorLayerBase, resolveLayerLocalTime } from '../engine-utils';
import type { GeneratorDeviceEngineHandler } from '../engine-types';

export const scannerEngineHandler = {
  kind: 'scanner',
  createLayer(device, worldBounds) {
    const params = device.params;
    if (!Number.isFinite(params.angleDeg) || !Number.isFinite(params.startOffset)) {
      return null;
    }

    return {
      ...createGeneratorLayerBase(device.id, worldBounds),
      kind: 'scanner',
      params,
      velocity: GENERATED_VELOCITY,
    };
  },
  buildPolyline(layer, t01, step) {
    const localT = resolveLayerLocalTime(layer, t01);
    if (localT === null) {
      return null;
    }

    return buildScannerPolyline(
      layer.originId,
      layer.params,
      localT,
      step,
      layer.velocity,
      layer.sourceBounds,
    );
  },
} satisfies GeneratorDeviceEngineHandler<'scanner'>;
