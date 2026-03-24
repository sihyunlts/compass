import { applyTranslateEffect } from '../../core/effects/translate';
import type { EffectDeviceEngineHandler } from '../engine-types';

export const translateEngineHandler = {
  kind: 'translate',
  applyEffect(sceneInstances, effect, context) {
    return applyTranslateEffect(sceneInstances, effect, context.worldBounds);
  },
} satisfies EffectDeviceEngineHandler<'translate'>;
