import { applyMirrorEffect } from '../../core/effects/mirror';
import type { EffectDeviceEngineHandler } from '../engine-types';

export const mirrorEngineHandler = {
  kind: 'mirror',
  applyEffect(layers, effect, context) {
    return applyMirrorEffect(layers, effect, context.worldBounds);
  },
} satisfies EffectDeviceEngineHandler<'mirror'>;
