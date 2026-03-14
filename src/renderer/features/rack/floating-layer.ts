import { clamp } from '../../../shared/math';

export type FloatingLayerSize = {
  width: number;
  height: number;
};

export type FloatingLayerPosition = {
  x: number;
  y: number;
};

export type AdjacentFloatingLayerOptions = {
  gapPx?: number;
  marginPx?: number;
};

export type FloatingLayerDismissHandlers = {
  isActive: () => boolean;
  containsEventTarget: (eventTarget: EventTarget | null) => boolean;
  onPointerDownOutside: (event: PointerEvent) => void;
  onResize: () => void;
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

/** Attaches shared outside-click and resize dismissal for a floating layer. */
export const attachFloatingLayerDismissHandlers = ({
  isActive,
  containsEventTarget,
  onPointerDownOutside,
  onResize,
}: FloatingLayerDismissHandlers): (() => void) => {
  const handleWindowPointerDown = (event: PointerEvent): void => {
    if (!isActive() || containsEventTarget(event.target)) {
      return;
    }

    onPointerDownOutside(event);
  };

  const handleWindowResize = (): void => {
    if (!isActive()) {
      return;
    }

    onResize();
  };

  window.addEventListener('pointerdown', handleWindowPointerDown, { capture: true });
  window.addEventListener('resize', handleWindowResize);

  return () => {
    window.removeEventListener('pointerdown', handleWindowPointerDown, true);
    window.removeEventListener('resize', handleWindowResize);
  };
};
