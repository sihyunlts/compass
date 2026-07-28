import {
  animateFloatingLayerEnter,
  animateFloatingLayerExit,
  resolveFloatingLayerEnterOffsetY,
} from './floating-layer';

let hintIdCounter = 0;

type HintValue = string | null | undefined;

type HintAction = {
  update: (nextValue: HintValue) => void;
  destroy: () => void;
};

const HINT_DELAY_MS = 360;
const VIEWPORT_PADDING_PX = 8;
const HINT_GAP_PX = 6;
const FLOATING_LAYER_VIEWPORT_TOP_PROPERTY = '--floating-layer-viewport-top';
const windowBlurCallbacks = new Set<() => void>();

const handleWindowBlur = (): void => {
  for (const closeHint of windowBlurCallbacks) {
    closeHint();
  }
};

const registerWindowBlurHandler = (closeHint: () => void): (() => void) => {
  if (windowBlurCallbacks.size === 0) {
    window.addEventListener('blur', handleWindowBlur);
  }
  windowBlurCallbacks.add(closeHint);

  return () => {
    windowBlurCallbacks.delete(closeHint);
    if (windowBlurCallbacks.size > 0) {
      return;
    }

    window.removeEventListener('blur', handleWindowBlur);
  };
};

const normalizeHint = (value: HintValue): string =>
  typeof value === 'string' ? value.trim() : '';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const resolveViewportTop = (node: HTMLElement): number => {
  const configuredTop = Number.parseFloat(
    window.getComputedStyle(node).getPropertyValue(FLOATING_LAYER_VIEWPORT_TOP_PROPERTY),
  );
  return Number.isFinite(configuredTop)
    ? Math.max(VIEWPORT_PADDING_PX, configuredTop)
    : VIEWPORT_PADDING_PX;
};

export const hint = (node: HTMLElement, value: HintValue): HintAction => {
  let hintText = normalizeHint(value);
  let hintEl: HTMLDivElement | null = null;
  let exitingHintEl: HTMLDivElement | null = null;
  let cancelEnterAnimation: (() => void) | null = null;
  let cancelExitAnimation: (() => void) | null = null;
  let showTimer: number | null = null;
  let previousDescribedBy: string | null = null;
  const hintId = `app-hint-${++hintIdCounter}`;

  const clearShowTimer = (): void => {
    if (showTimer === null) {
      return;
    }

    window.clearTimeout(showTimer);
    showTimer = null;
  };

  const positionHint = (): number | null => {
    if (!hintEl) {
      return null;
    }

    const anchorRect = node.getBoundingClientRect();
    const hintRect = hintEl.getBoundingClientRect();
    const viewportTop = resolveViewportTop(node);
    const maxX = Math.max(VIEWPORT_PADDING_PX, window.innerWidth - hintRect.width - VIEWPORT_PADDING_PX);
    const x = clamp(
      anchorRect.left + (anchorRect.width - hintRect.width) / 2,
      VIEWPORT_PADDING_PX,
      maxX,
    );
    const belowY = anchorRect.bottom + HINT_GAP_PX;
    const aboveY = anchorRect.top - hintRect.height - HINT_GAP_PX;
    const canOpenAbove = aboveY >= viewportTop;
    const canOpenBelow =
      belowY + hintRect.height <= window.innerHeight - VIEWPORT_PADDING_PX;
    const opensAbove = canOpenAbove
      || (!canOpenBelow && anchorRect.top >= window.innerHeight - anchorRect.bottom);
    const y = opensAbove
      ? Math.max(viewportTop, aboveY)
      : Math.min(
        belowY,
        Math.max(viewportTop, window.innerHeight - hintRect.height - VIEWPORT_PADDING_PX),
      );

    hintEl.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    return resolveFloatingLayerEnterOffsetY(opensAbove ? 'above' : 'below');
  };

  const closeHint = (): void => {
    clearShowTimer();
    const wasOpen = hintEl !== null;
    const closingHintEl = hintEl;
    const cancelEnteringHint = cancelEnterAnimation;
    hintEl = null;
    cancelEnterAnimation = null;

    if (wasOpen) {
      if (previousDescribedBy === null) {
        node.removeAttribute('aria-describedby');
      } else {
        node.setAttribute('aria-describedby', previousDescribedBy);
      }
      previousDescribedBy = null;
    }

    if (closingHintEl) {
      cancelExitAnimation?.();
      exitingHintEl?.remove();
      exitingHintEl = closingHintEl;
      cancelExitAnimation = animateFloatingLayerExit(
        [{ element: closingHintEl }],
        () => {
          closingHintEl.remove();
          if (exitingHintEl === closingHintEl) {
            exitingHintEl = null;
            cancelExitAnimation = null;
          }
        },
      );
    }
    cancelEnteringHint?.();

    window.removeEventListener('scroll', closeHint, true);
    window.removeEventListener('resize', closeHint);
    document.removeEventListener('pointerdown', closeHint, true);
    document.removeEventListener('keydown', handleDocumentKeyDown, true);
  };

  const openHint = (): void => {
    clearShowTimer();
    if (!hintText || node.matches(':disabled')) {
      return;
    }

    const shouldAnimateEnter = hintEl === null;
    if (!hintEl) {
      cancelExitAnimation?.();
      cancelExitAnimation = null;
      exitingHintEl?.remove();
      exitingHintEl = null;
      previousDescribedBy = node.getAttribute('aria-describedby');
      node.setAttribute(
        'aria-describedby',
        previousDescribedBy ? `${previousDescribedBy} ${hintId}` : hintId,
      );

      hintEl = document.createElement('div');
      hintEl.id = hintId;
      hintEl.className = 'app-hint';
      hintEl.dataset.floatingLayerMotion = 'managed';
      hintEl.role = 'tooltip';
      document.body.append(hintEl);

      window.addEventListener('scroll', closeHint, true);
      window.addEventListener('resize', closeHint);
      document.addEventListener('pointerdown', closeHint, true);
      document.addEventListener('keydown', handleDocumentKeyDown, true);
    }

    hintEl.textContent = hintText;
    const enterY = positionHint();
    const enteringHintEl = hintEl;
    if (shouldAnimateEnter && enterY !== null) {
      cancelEnterAnimation = animateFloatingLayerEnter(
        [{ element: enteringHintEl, translateY: enterY }],
        () => {
          if (hintEl === enteringHintEl) {
            cancelEnterAnimation = null;
          }
        },
      );
    }
  };

  function handleDocumentKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      closeHint();
    }
  }

  const scheduleHint = (delayMs: number): void => {
    clearShowTimer();
    if (!hintText || node.matches(':disabled')) {
      return;
    }

    showTimer = window.setTimeout(openHint, delayMs);
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' || hintEl || showTimer !== null) {
      return;
    }
    scheduleHint(HINT_DELAY_MS);
  };
  const handlePointerDown = (): void => {
    closeHint();
  };
  const handleFocus = (): void => {
    if (
      document.body.dataset.focusNav === 'tab'
      && node.matches(':focus-visible')
    ) {
      scheduleHint(0);
    }
  };

  node.addEventListener('pointermove', handlePointerMove);
  node.addEventListener('pointerdown', handlePointerDown);
  node.addEventListener('pointerleave', closeHint);
  node.addEventListener('focus', handleFocus);
  node.addEventListener('blur', closeHint);
  const unregisterWindowBlurHandler = registerWindowBlurHandler(closeHint);

  return {
    update(nextValue: HintValue): void {
      hintText = normalizeHint(nextValue);
      if (!hintText) {
        closeHint();
        return;
      }

      if (hintEl) {
        hintEl.textContent = hintText;
        positionHint();
      }
    },
    destroy(): void {
      node.removeEventListener('pointermove', handlePointerMove);
      node.removeEventListener('pointerdown', handlePointerDown);
      node.removeEventListener('pointerleave', closeHint);
      node.removeEventListener('focus', handleFocus);
      node.removeEventListener('blur', closeHint);
      unregisterWindowBlurHandler();
      closeHint();
      cancelEnterAnimation?.();
      cancelExitAnimation?.();
      exitingHintEl?.remove();
      exitingHintEl = null;
      cancelEnterAnimation = null;
      cancelExitAnimation = null;
    },
  };
};
