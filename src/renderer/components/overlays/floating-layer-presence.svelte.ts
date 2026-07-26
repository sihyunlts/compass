import {
  animateFloatingLayerEnter,
  animateFloatingLayerExit,
} from './floating-layer';
import type {
  FloatingLayerEnterTarget,
  FloatingLayerExitTarget,
} from './floating-layer';

export class FloatingLayerPresence {
  rendered = $state(false);
  exiting = $state(false);

  #cancelEnterAnimation: (() => void) | null = null;
  #cancelExitAnimation: (() => void) | null = null;

  show(): boolean {
    const wasRendered = this.rendered;
    this.#cancelExitAnimation?.();
    this.#cancelExitAnimation = null;
    this.exiting = false;
    this.rendered = true;
    return !wasRendered;
  }

  enter(targets: readonly FloatingLayerEnterTarget[]): void {
    this.#cancelEnterAnimation?.();
    this.#cancelEnterAnimation = animateFloatingLayerEnter(targets, () => {
      this.#cancelEnterAnimation = null;
    });
  }

  hide(
    targets: readonly FloatingLayerExitTarget[],
    onHidden: () => void = () => {},
  ): void {
    if (!this.rendered || this.exiting) {
      return;
    }

    this.exiting = true;
    const cancelEnterAnimation = this.#cancelEnterAnimation;
    this.#cancelExitAnimation = animateFloatingLayerExit(targets, () => {
      this.#cancelExitAnimation = null;
      this.rendered = false;
      this.exiting = false;
      onHidden();
    });
    cancelEnterAnimation?.();
    this.#cancelEnterAnimation = null;
  }

  hideImmediately(onHidden: () => void = () => {}): void {
    this.#cancelEnterAnimation?.();
    this.#cancelExitAnimation?.();
    this.#cancelEnterAnimation = null;
    this.#cancelExitAnimation = null;
    this.rendered = false;
    this.exiting = false;
    onHidden();
  }

  destroy(): void {
    this.#cancelEnterAnimation?.();
    this.#cancelExitAnimation?.();
    this.#cancelEnterAnimation = null;
    this.#cancelExitAnimation = null;
  }
}
