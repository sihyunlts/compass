import { GENERATED_VELOCITY } from '../../core/pipeline/constants';
import { buildScannerPolyline } from '../../core/generators/scanner';
import { createSceneInstanceBase, resolveSceneLocalTime } from '../engine-utils';
import type { GeneratorDeviceEngineHandler } from '../engine-types';

export const scannerEngineHandler = {
  kind: 'scanner',
  createSceneInstance(device, worldBounds) {
    const params = device.params;
    if (!Number.isFinite(params.angleDeg) || !Number.isFinite(params.startOffset)) {
      return null;
    }

    return {
      ...createSceneInstanceBase(device.id, worldBounds),
      primitive: {
        kind: 'scanner',
        params,
      },
      velocity: GENERATED_VELOCITY,
    };
  },
  buildPolyline(sceneInstance, t01, step) {
    const localT = resolveSceneLocalTime(sceneInstance, t01);
    if (localT === null) {
      return null;
    }

    return buildScannerPolyline(
      sceneInstance.originId,
      sceneInstance.primitive.params,
      localT,
      step,
      sceneInstance.velocity,
      sceneInstance.sourceBounds,
    );
  },
} satisfies GeneratorDeviceEngineHandler<'scanner'>;
