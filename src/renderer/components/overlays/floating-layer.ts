import { clamp } from '../../../shared/math';

export type FloatingLayerSize = {
  width: number;
  height: number;
};

export type FloatingLayerPosition = {
  x: number;
  y: number;
};

export type FloatingLayerVerticalPlacement = 'above' | 'below';

export type AnchoredFloatingLayerPosition = FloatingLayerPosition & {
  maxHeight: number;
  verticalPlacement: FloatingLayerVerticalPlacement;
};

type AdjacentFloatingLayerOptions = {
  gapPx?: number;
  marginPx?: number;
};

type FloatingLayerDismissHandlers = {
  isActive: () => boolean;
  containsEventTarget: (eventTarget: EventTarget | null) => boolean;
  onPointerDownOutside: () => void;
  onResize: () => void;
  onDismissRequest?: () => void;
};

export const DEFAULT_FLOATING_LAYER_MARGIN_PX = 8;
export const FLOATING_LAYER_ENTER_DISTANCE_PX = 6;
export const FLOATING_LAYER_ENTER_SPRING_OPTIONS = {
  stiffness: 0.2,
  damping: 0.8,
} as const;
const FLOATING_LAYER_EXIT_DURATION_MS = 140;

export const resolveFloatingLayerEnterOffsetY = (
  verticalPlacement: FloatingLayerVerticalPlacement,
): number => verticalPlacement === 'above'
  ? FLOATING_LAYER_ENTER_DISTANCE_PX
  : -FLOATING_LAYER_ENTER_DISTANCE_PX;

const shouldReduceFloatingLayerMotion = (): boolean =>
  document.documentElement.classList.contains('reduce-animation')
  || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const animateFloatingLayerExit = (
  layerEl: HTMLElement,
  onFinish: () => void,
): (() => void) => {
  const wasInert = layerEl.inert;
  const previousPointerEvents = layerEl.style.pointerEvents;
  const restoreInteraction = (): void => {
    layerEl.inert = wasInert;
    if (previousPointerEvents) {
      layerEl.style.pointerEvents = previousPointerEvents;
    } else {
      layerEl.style.removeProperty('pointer-events');
    }
  };

  layerEl.inert = true;
  layerEl.style.pointerEvents = 'none';

  if (shouldReduceFloatingLayerMotion()) {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        restoreInteraction();
        onFinish();
      }
    });
    return () => {
      cancelled = true;
      restoreInteraction();
    };
  }

  const computedStyle = window.getComputedStyle(layerEl);
  const positionedTransform = computedStyle.transform === 'none'
    ? ''
    : computedStyle.transform;
  const animation = layerEl.animate(
    [
      {
        opacity: computedStyle.opacity,
        filter: computedStyle.filter,
        transform: positionedTransform || 'scale(1)',
      },
      {
        opacity: '0',
        filter: 'blur(4px)',
        transform: positionedTransform
          ? `${positionedTransform} scale(1.04)`
          : 'scale(1.04)',
      },
    ],
    {
      duration: FLOATING_LAYER_EXIT_DURATION_MS,
      easing: 'cubic-bezier(0.4, 0, 1, 1)',
      fill: 'forwards',
    },
  );

  animation.onfinish = () => {
    animation.onfinish = null;
    animation.cancel();
    restoreInteraction();
    onFinish();
  };

  return () => {
    animation.onfinish = null;
    animation.cancel();
    restoreInteraction();
  };
};

export const isEventTargetWithinFloatingLayer = (
  eventTarget: EventTarget | null,
  layerEl: HTMLElement | null,
): boolean => eventTarget instanceof Node && layerEl !== null && layerEl.contains(eventTarget);

export const resolveViewportFloatingLayerPosition = (
  x: number,
  y: number,
  size: FloatingLayerSize,
  marginPx: number = DEFAULT_FLOATING_LAYER_MARGIN_PX,
): FloatingLayerPosition => ({
  x: clamp(
    x,
    marginPx,
    Math.max(marginPx, window.innerWidth - size.width - marginPx),
  ),
  y: clamp(
    y,
    marginPx,
    Math.max(marginPx, window.innerHeight - size.height - marginPx),
  ),
});

export const resolveAnchoredFloatingLayerPosition = (
  anchorRect: DOMRect | DOMRectReadOnly,
  size: FloatingLayerSize,
  options: AdjacentFloatingLayerOptions = {},
): AnchoredFloatingLayerPosition => {
  const gapPx = options.gapPx ?? DEFAULT_FLOATING_LAYER_MARGIN_PX;
  const marginPx = options.marginPx ?? DEFAULT_FLOATING_LAYER_MARGIN_PX;
  const belowSpace = Math.max(0, window.innerHeight - anchorRect.bottom - gapPx - marginPx);
  const aboveSpace = Math.max(0, anchorRect.top - gapPx - marginPx);
  const opensBelow = belowSpace >= Math.min(size.height, belowSpace + aboveSpace)
    || belowSpace >= aboveSpace;
  const availableHeight = opensBelow ? belowSpace : aboveSpace;
  const renderedHeight = Math.min(size.height, availableHeight);
  const preferredY = opensBelow
    ? anchorRect.bottom + gapPx
    : anchorRect.top - gapPx - renderedHeight;

  return {
    x: clamp(
      anchorRect.left,
      marginPx,
      Math.max(marginPx, window.innerWidth - size.width - marginPx),
    ),
    y: clamp(
      preferredY,
      marginPx,
      Math.max(marginPx, window.innerHeight - renderedHeight - marginPx),
    ),
    maxHeight: availableHeight,
    verticalPlacement: opensBelow ? 'below' : 'above',
  };
};

export const resolveAdjacentFloatingLayerPosition = (
  anchorRect: DOMRect | DOMRectReadOnly,
  size: FloatingLayerSize,
  options: AdjacentFloatingLayerOptions = {},
): FloatingLayerPosition => {
  const gapPx = options.gapPx ?? DEFAULT_FLOATING_LAYER_MARGIN_PX;
  const marginPx = options.marginPx ?? DEFAULT_FLOATING_LAYER_MARGIN_PX;
  const preferredX = anchorRect.right + gapPx;
  const fallbackX = anchorRect.left - size.width - gapPx;
  const maxX = Math.max(marginPx, window.innerWidth - size.width - marginPx);

  return {
    x: preferredX <= maxX
      ? preferredX
      : clamp(fallbackX, marginPx, maxX),
    y: clamp(
      anchorRect.top,
      marginPx,
      Math.max(marginPx, window.innerHeight - size.height - marginPx),
    ),
  };
};

/** Attaches shared outside-interaction dismissal for a floating layer. */
export const attachFloatingLayerDismissHandlers = ({
  isActive,
  containsEventTarget,
  onPointerDownOutside,
  onResize,
  onDismissRequest,
}: FloatingLayerDismissHandlers): (() => void) => {
  const handleWindowPointerDown = (event: PointerEvent): void => {
    if (!isActive() || containsEventTarget(event.target)) {
      return;
    }

    onPointerDownOutside();
  };

  const handleWindowResize = (): void => {
    if (!isActive()) {
      return;
    }

    onResize();
  };

  const dismissFromOutsideEvent = (event: Event): void => {
    if (!isActive() || containsEventTarget(event.target)) {
      return;
    }

    onDismissRequest?.();
  };

  window.addEventListener('pointerdown', handleWindowPointerDown, { capture: true });
  window.addEventListener('wheel', dismissFromOutsideEvent, { capture: true, passive: true });
  window.addEventListener('scroll', dismissFromOutsideEvent, { capture: true, passive: true });
  window.addEventListener('resize', handleWindowResize);

  return () => {
    window.removeEventListener('pointerdown', handleWindowPointerDown, true);
    window.removeEventListener('wheel', dismissFromOutsideEvent, true);
    window.removeEventListener('scroll', dismissFromOutsideEvent, true);
    window.removeEventListener('resize', handleWindowResize);
  };
};
