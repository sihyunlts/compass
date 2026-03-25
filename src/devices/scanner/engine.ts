import { GENERATED_VELOCITY } from '../../core/pipeline/constants';
import { buildScannerPolyline } from '../../core/generators/scanner';
import { createSceneInstanceBase, resolveSceneOutputState } from '../engine-utils';
import type { GeneratorDeviceEngineHandler } from '../engine-types';

export const scannerEngineHandler = {
  kind: 'scanner',
  createSceneInstance(device, worldBounds) {
    const params = device.params;
    if (!Number.isFinite(params.angleDeg)) {
      return null;
    }

    return {
      ...createSceneInstanceBase(device.id, device.groupId, worldBounds),
      primitive: {
        kind: 'scanner',
        params,
      },
      velocity: GENERATED_VELOCITY,
    };
  },
  buildPolyline(sceneInstance, t01, step) {
    const outputState = resolveSceneOutputState(sceneInstance, t01);
    if (outputState === null) {
      return null;
    }

    return buildScannerPolyline(
      sceneInstance.originId,
      sceneInstance.primitive.params,
      outputState.localT,
      step,
      sceneInstance.velocity,
      sceneInstance.sourceBounds,
    );
  },
} satisfies GeneratorDeviceEngineHandler<'scanner'>;
