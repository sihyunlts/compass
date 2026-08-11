import { Spring } from 'svelte/motion';

import { SPRING_PRECISION, shouldReduceMotion } from '../../motion';

const BUTTON_PRESSED_SCALE = 0.95;
const BUTTON_PRESS_SPRING_OPTIONS = {
  stiffness: 0.2,
  damping: 0.8,
  precision: SPRING_PRECISION,
} as const;

export const buttonPress = (node: HTMLElement): { destroy: () => void } => {
  const scale = new Spring(1, BUTTON_PRESS_SPRING_OPTIONS);
  const destroyScaleEffect = $effect.root(() => {
    $effect(() => {
      node.style.transform = `scale(${scale.current})`;
    });
  });

  const press = (): void => {
    if (!shouldReduceMotion()) {
      scale.target = BUTTON_PRESSED_SCALE;
    }
  };
  const release = (): void => {
    scale.target = 1;
  };
  const handlePointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (
      event.button === 0
      && target instanceof Element
      && target.closest('button:not(:disabled)')
    ) {
      press();
    }
  };

  node.addEventListener('pointerdown', handlePointerDown);
  node.addEventListener('pointerup', release);
  node.addEventListener('pointercancel', release);
  node.addEventListener('pointerleave', release);

  return {
    destroy(): void {
      node.removeEventListener('pointerdown', handlePointerDown);
      node.removeEventListener('pointerup', release);
      node.removeEventListener('pointercancel', release);
      node.removeEventListener('pointerleave', release);
      destroyScaleEffect();
    },
  };
};
