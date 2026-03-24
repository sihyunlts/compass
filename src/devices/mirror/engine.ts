import { applyMirrorEffect } from '../../core/effects/mirror';
import type { EffectDeviceEngineHandler } from '../engine-types';

export const mirrorEngineHandler = {
  kind: 'mirror',
  applyEffect(sceneInstances, effect, context) {
    return applyMirrorEffect(sceneInstances, effect, context.worldBounds);
  },
} satisfies EffectDeviceEngineHandler<'mirror'>;
