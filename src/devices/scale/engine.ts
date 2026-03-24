import { applyScaleEffect } from '../../core/effects/scale';
import type { EffectDeviceEngineHandler } from '../engine-types';

export const scaleEngineHandler = {
  kind: 'scale',
  applyEffect(sceneInstances, effect, context) {
    return applyScaleEffect(sceneInstances, effect, context.worldBounds);
  },
} satisfies EffectDeviceEngineHandler<'scale'>;
