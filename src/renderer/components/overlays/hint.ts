import {
  animateFloatingLayerEnter,
  animateFloatingLayerExit,
  FLOATING_LAYER_ENTER_DISTANCE_PX,
  resolveAdjacentFloatingLayerPosition,
  resolveFloatingLayerEnterOffsetY,
} from './floating-layer';
import {
  activateFloatingLayer,
  createFloatingLayerId,
  deactivateFloatingLayer,
  hasActiveFloatingLayerDescendant,
  resolveFloatingLayerParentId,
} from './floating-layer-stack';

let hintIdCounter = 0;

type HintValue = string | null | undefined;
type HintPlacement = 'auto' | 'above' | 'below' | 'adjacent';
type HintContentCleanup = () => void;
type HintContentRenderer = (
  container: HTMLDivElement,
) => void | HintContentCleanup;
type HintEnterOffset = {
  translateX?: number;
  translateY?: number;
};
export type HintInput = HintValue | {
  text: HintValue;
  placement?: HintPlacement;
  delayMs?: number;
  gapPx?: number;
  dismissOnPointerDown?: boolean;
  className?: string;
  renderContent?: HintContentRenderer;
};

type HintAction = {
  update: (nextValue: HintInput) => void;
  destroy: () => void;
};

interface VisibleHintOwner {
  closeImmediately: () => void;
}

const DEFAULT_HINT_DELAY_MS = 360;
const VIEWPORT_PADDING_PX = 8;
const HINT_GAP_PX = 4;
const FLOATING_LAYER_VIEWPORT_TOP_PROPERTY = '--floating-layer-viewport-top';
const windowBlurCallbacks = new Set<() => void>();
let visibleHintOwner: VisibleHintOwner | null = null;

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

const normalizeNonNegativeOption = (
  value: unknown,
  fallback: number,
): number => typeof value === 'number' && Number.isFinite(value)
  ? Math.max(0, value)
  : fallback;

const normalizeHint = (value: HintInput): {
  text: string;
  placement: HintPlacement;
  delayMs: number;
  gapPx: number;
  dismissOnPointerDown: boolean;
  className: string;
  renderContent: HintContentRenderer | null;
} => {
  const options = typeof value === 'object' && value !== null ? value : null;
  const textValue = options?.text ?? value;
  return {
    text: typeof textValue === 'string' ? textValue.trim() : '',
    placement: options?.placement ?? 'auto',
    delayMs: normalizeNonNegativeOption(options?.delayMs, DEFAULT_HINT_DELAY_MS),
    gapPx: normalizeNonNegativeOption(options?.gapPx, HINT_GAP_PX),
    dismissOnPointerDown: options?.dismissOnPointerDown ?? true,
    className: typeof options?.className === 'string'
      ? options.className.trim()
      : '',
    renderContent: typeof options?.renderContent === 'function'
      ? options.renderContent
      : null,
  };
};

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

export const hint = (node: HTMLElement, value: HintInput): HintAction => {
  let {
    text: hintText,
    placement: hintPlacement,
    delayMs: hintDelayMs,
    gapPx: hintGapPx,
    dismissOnPointerDown,
    className: hintClassName,
    renderContent: renderHintContent,
  } = normalizeHint(value);
  let hintEl: HTMLDivElement | null = null;
  let exitingHintEl: HTMLDivElement | null = null;
  let cancelEnterAnimation: (() => void) | null = null;
  let cancelExitAnimation: (() => void) | null = null;
  let cleanupHintContent: HintContentCleanup | null = null;
  let showTimer: number | null = null;
  let previousDescribedBy: string | null = null;
  const hintId = `app-hint-${++hintIdCounter}`;
  const floatingLayerId = createFloatingLayerId('hint');
  let closePendingForDescendant = false;
  const owner: VisibleHintOwner = {
    closeImmediately: () => closeHintImmediately(),
  };

  const clearShowTimer = (): void => {
    if (showTimer === null) {
      return;
    }

    window.clearTimeout(showTimer);
    showTimer = null;
  };

  const clearHintContent = (): void => {
    cleanupHintContent?.();
    cleanupHintContent = null;
  };

  const positionHint = (): HintEnterOffset | null => {
    if (!hintEl) {
      return null;
    }

    const anchorRect = node.getBoundingClientRect();
    const hintRect = hintEl.getBoundingClientRect();
    if (hintPlacement === 'adjacent') {
      const position = resolveAdjacentFloatingLayerPosition(
        anchorRect,
        hintRect,
        { gapPx: hintGapPx },
      );
      hintEl.style.transform = `translate3d(${Math.round(position.x)}px, ${Math.round(position.y)}px, 0)`;
      return {
        translateX: position.x >= anchorRect.right
          ? -FLOATING_LAYER_ENTER_DISTANCE_PX
          : FLOATING_LAYER_ENTER_DISTANCE_PX,
      };
    }

    const viewportTop = resolveViewportTop(node);
    const maxX = Math.max(VIEWPORT_PADDING_PX, window.innerWidth - hintRect.width - VIEWPORT_PADDING_PX);
    const x = clamp(
      anchorRect.left + (anchorRect.width - hintRect.width) / 2,
      VIEWPORT_PADDING_PX,
      maxX,
    );
    const belowY = anchorRect.bottom + hintGapPx;
    const aboveY = anchorRect.top - hintRect.height - hintGapPx;
    const canOpenAbove = aboveY >= viewportTop;
    const canOpenBelow =
      belowY + hintRect.height <= window.innerHeight - VIEWPORT_PADDING_PX;
    const opensAbove = hintPlacement === 'above' || (
      hintPlacement === 'auto' && (
        canOpenAbove
        || (!canOpenBelow && anchorRect.top >= window.innerHeight - anchorRect.bottom)
      )
    );
    const y = opensAbove
      ? Math.max(viewportTop, aboveY)
      : Math.min(
        belowY,
        Math.max(viewportTop, window.innerHeight - hintRect.height - VIEWPORT_PADDING_PX),
      );

    hintEl.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    return {
      translateY: resolveFloatingLayerEnterOffsetY(opensAbove ? 'above' : 'below'),
    };
  };

  const updateHintContent = (): void => {
    if (!hintEl) {
      return;
    }

    clearHintContent();
    hintEl.className = ['app-hint', hintClassName]
      .filter(Boolean)
      .join(' ');
    if (renderHintContent) {
      hintEl.replaceChildren();
      const cleanup = renderHintContent(hintEl);
      cleanupHintContent = typeof cleanup === 'function' ? cleanup : null;
      return;
    }

    hintEl.textContent = hintText;
  };

  const closeHint = (): void => {
    clearShowTimer();
    if (hintEl && hasActiveFloatingLayerDescendant(floatingLayerId)) {
      closePendingForDescendant = true;
      return;
    }
    closePendingForDescendant = false;
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
      clearHintContent();
      deactivateFloatingLayer(floatingLayerId);
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
          if (visibleHintOwner === owner) {
            visibleHintOwner = null;
          }
        },
      );
    }
    cancelEnteringHint?.();

    window.removeEventListener('scroll', closeHint, true);
    window.removeEventListener('resize', closeHint);
    document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
  };

  const closeHintImmediately = (): void => {
    clearShowTimer();
    clearHintContent();
    closePendingForDescendant = false;
    deactivateFloatingLayer(floatingLayerId);
    const wasOpen = hintEl !== null;
    if (wasOpen) {
      if (previousDescribedBy === null) {
        node.removeAttribute('aria-describedby');
      } else {
        node.setAttribute('aria-describedby', previousDescribedBy);
      }
    }
    previousDescribedBy = null;

    cancelEnterAnimation?.();
    cancelExitAnimation?.();
    hintEl?.remove();
    exitingHintEl?.remove();
    hintEl = null;
    exitingHintEl = null;
    cancelEnterAnimation = null;
    cancelExitAnimation = null;
    if (visibleHintOwner === owner) {
      visibleHintOwner = null;
    }

    window.removeEventListener('scroll', closeHint, true);
    window.removeEventListener('resize', closeHint);
    document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
  };

  const openHint = (animateEnter = true): void => {
    clearShowTimer();
    if (!hintText || node.matches(':disabled')) {
      return;
    }

    const shouldAnimateEnter = animateEnter && hintEl === null;
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
      hintEl.dataset.floatingLayerMotion = 'managed';
      hintEl.role = 'tooltip';
      hintEl.style.visibility = 'hidden';
      document.body.append(hintEl);
      visibleHintOwner = owner;
      activateFloatingLayer({
        id: floatingLayerId,
        parentId: resolveFloatingLayerParentId(node, floatingLayerId),
        containsEventTarget: (eventTarget) => eventTarget instanceof Node && (
          node.contains(eventTarget)
          || hintEl?.contains(eventTarget) === true
        ),
        onDismissRequest: closeHint,
        onDescendantStateChange: (hasActiveDescendant) => {
          if (!hasActiveDescendant && closePendingForDescendant) {
            queueMicrotask(closeHint);
          }
        },
        onStackOrderChange: (stackOrder) => {
          hintEl?.style.setProperty('--floating-layer-stack-order', String(stackOrder));
        },
      });

      window.addEventListener('scroll', closeHint, true);
      window.addEventListener('resize', closeHint);
      document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    }

    updateHintContent();
    const enterOffset = positionHint();
    const enteringHintEl = hintEl;
    if (shouldAnimateEnter && enterOffset !== null) {
      cancelEnterAnimation = animateFloatingLayerEnter(
        [{ element: enteringHintEl, ...enterOffset }],
        () => {
          if (hintEl === enteringHintEl) {
            cancelEnterAnimation = null;
          }
        },
      );
    }
    enteringHintEl?.style.removeProperty('visibility');
  };

  function handleDocumentPointerDown(event: PointerEvent): void {
    if (!dismissOnPointerDown && event.composedPath().includes(node)) {
      return;
    }
    closeHint();
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
    if (hintText && visibleHintOwner && visibleHintOwner !== owner) {
      visibleHintOwner.closeImmediately();
      openHint(false);
      return;
    }
    scheduleHint(hintDelayMs);
  };
  const handlePointerDown = (): void => {
    if (dismissOnPointerDown) {
      closeHint();
    }
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
    update(nextValue: HintInput): void {
      const normalized = normalizeHint(nextValue);
      hintText = normalized.text;
      hintPlacement = normalized.placement;
      hintDelayMs = normalized.delayMs;
      hintGapPx = normalized.gapPx;
      dismissOnPointerDown = normalized.dismissOnPointerDown;
      hintClassName = normalized.className;
      renderHintContent = normalized.renderContent;
      if (!hintText) {
        closeHint();
        return;
      }

      if (hintEl) {
        updateHintContent();
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
      closeHintImmediately();
    },
  };
};
