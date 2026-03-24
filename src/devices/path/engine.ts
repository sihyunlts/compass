import { GENERATED_VELOCITY } from '../../core/pipeline/constants';
import { buildPathPolyline } from '../../core/generators/path';
import { createSceneInstanceBase, isSceneInstanceVisibleAtTime } from '../engine-utils';
import type { GeneratorDeviceEngineHandler } from '../engine-types';

export const pathEngineHandler = {
  kind: 'path',
  createSceneInstance(device, worldBounds) {
    if (device.params.points.length < 2) {
      return null;
    }

    for (const point of device.params.points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        return null;
      }
    }

    return {
      ...createSceneInstanceBase(device.id, device.groupId, worldBounds),
      primitive: {
        kind: 'path',
        params: device.params,
      },
      velocity: GENERATED_VELOCITY,
    };
  },
  buildPolyline(sceneInstance, t01, step) {
    void step;
    if (!isSceneInstanceVisibleAtTime(sceneInstance, t01)) {
      return null;
    }

    return buildPathPolyline(
      sceneInstance.originId,
      sceneInstance.primitive.params,
      sceneInstance.velocity,
    );
  },
} satisfies GeneratorDeviceEngineHandler<'path'>;
