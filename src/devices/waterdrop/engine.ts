import { GENERATED_VELOCITY } from '../../core/pipeline/constants';
import { buildWaterdropPolyline } from '../../core/generators/waterdrop';
import { createSceneInstanceBase, resolveSceneLocalTime } from '../engine-utils';
import type { GeneratorDeviceEngineHandler } from '../engine-types';

export const waterdropEngineHandler = {
  kind: 'waterdrop',
  createSceneInstance(device, worldBounds) {
    const params = device.params;
    if (!Number.isFinite(params.centerX)
      || !Number.isFinite(params.centerY)
      || !Number.isFinite(params.curvature)
      || !Number.isFinite(params.startRadius)) {
      return null;
    }

    return {
      ...createSceneInstanceBase(device.id, worldBounds),
      primitive: {
        kind: 'waterdrop',
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

    return buildWaterdropPolyline(
      sceneInstance.originId,
      sceneInstance.primitive.params,
      localT,
      step,
      sceneInstance.velocity,
    );
  },
} satisfies GeneratorDeviceEngineHandler<'waterdrop'>;
