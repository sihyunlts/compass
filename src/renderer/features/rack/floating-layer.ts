import { clamp } from '../../../shared/math';

export type FloatingLayerSize = {
  width: number;
  height: number;
};

export type FloatingLayerPosition = {
  x: number;
  y: number;
};

export type AnchoredFloatingLayerPosition = FloatingLayerPosition & {
  maxHeight: number;
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
