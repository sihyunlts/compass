import { GENERATED_VELOCITY } from '../../core/pipeline/constants';
import { buildWaterdropPolyline } from '../../core/generators/waterdrop';
import { createSceneInstanceBase, resolveSceneOutputState } from '../engine-utils';
import type { GeneratorDeviceEngineHandler } from '../engine-types';

export const waterdropEngineHandler = {
  kind: 'waterdrop',
  createSceneInstance(device, worldBounds) {
    const params = device.params;
    if (!Number.isFinite(params.centerX)
      || !Number.isFinite(params.centerY)
      || !Number.isFinite(params.curvature)) {
      return null;
    }

    return {
      ...createSceneInstanceBase(device.id, device.groupId, worldBounds),
      primitive: {
        kind: 'waterdrop',
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

    return buildWaterdropPolyline(
      sceneInstance.originId,
      sceneInstance.primitive.params,
      outputState.localT,
      step,
      sceneInstance.velocity,
    );
  },
} satisfies GeneratorDeviceEngineHandler<'waterdrop'>;
