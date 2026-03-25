import { GENERATED_VELOCITY } from '../../core/pipeline/constants';
import { buildSpiralPolyline } from '../../core/generators/spiral';
import { createSceneInstanceBase, resolveSceneLocalTime } from '../engine-utils';
import type { GeneratorDeviceEngineHandler } from '../engine-types';

export const spiralEngineHandler = {
  kind: 'spiral',
  createSceneInstance(device, worldBounds) {
    const params = device.params;
    if (!Number.isFinite(params.centerX)
      || !Number.isFinite(params.centerY)
      || !Number.isFinite(params.turns)) {
      return null;
    }

    return {
      ...createSceneInstanceBase(device.id, device.groupId, worldBounds),
      primitive: {
        kind: 'spiral',
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

    return buildSpiralPolyline(
      sceneInstance.originId,
      sceneInstance.primitive.params,
      localT,
      step,
      sceneInstance.velocity,
    );
  },
} satisfies GeneratorDeviceEngineHandler<'spiral'>;
