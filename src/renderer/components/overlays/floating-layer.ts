import { clamp } from '../../../shared/math';
import { SPRING_PRECISION } from '../../motion';
import { isTopmostFloatingLayer } from './floating-layer-stack';

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
  horizontalAlignment?: 'start' | 'center' | 'end';
};

type FloatingLayerDismissHandlers = {
  layerId?: string;
  isActive: () => boolean;
  containsEventTarget: (eventTarget: EventTarget | null) => boolean;
  onPointerDownOutside: () => void;
  onResize: () => void;
  onDismissRequest?: () => void;
};

export type FloatingLayerEnterTarget = {
  element: HTMLElement;
  blurPx?: number | null;
  translateY?: number;
  durationMs?: number;
  easing?: string;
};

export type FloatingLayerExitTarget = {
  element: HTMLElement;
  targetScale?: number | null;
  blurPx?: number | null;
  durationMs?: number;
  easing?: string;
};

export const DEFAULT_FLOATING_LAYER_MARGIN_PX = 8;
export const FLOATING_LAYER_ENTER_DISTANCE_PX = 6;
export const FLOATING_LAYER_ENTER_SPRING_OPTIONS = {
  stiffness: 0.2,
  damping: 0.8,
  precision: SPRING_PRECISION,
} as const;
export const FLOATING_LAYER_ENTER_DURATION_MS = 150;
export const FLOATING_LAYER_ENTER_EASING = 'cubic-bezier(0, 0.5, 0.5, 1)';
export const FLOATING_LAYER_EXIT_DURATION_MS = 200;
export const FLOATING_LAYER_EXIT_EASING = 'cubic-bezier(0.4, 0, 1, 1)';

export const resolveFloatingLayerEnterOffsetY = (
  verticalPlacement: FloatingLayerVerticalPlacement,
): number => verticalPlacement === 'above'
  ? FLOATING_LAYER_ENTER_DISTANCE_PX
  : -FLOATING_LAYER_ENTER_DISTANCE_PX;

const shouldReduceFloatingLayerMotion = (): boolean =>
  document.documentElement.classList.contains('reduce-animation')
  || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const animateFloatingLayerEnter = (
  targets: readonly FloatingLayerEnterTarget[],
  onFinish: () => void = () => {},
): (() => void) => {
  if (targets.length === 0 || shouldReduceFloatingLayerMotion()) {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        onFinish();
      }
    });
    return () => {
      cancelled = true;
    };
  }

  let remainingAnimations = targets.length;
  let finished = false;
  const animations = targets.map((target) => {
    const fromKeyframe: Keyframe = { opacity: '0' };
    const toKeyframe: Keyframe = { opacity: '1' };
    if (target.blurPx !== null) {
      fromKeyframe.filter = `blur(${target.blurPx ?? 4}px)`;
      toKeyframe.filter = 'blur(0)';
    }
    if (target.translateY !== undefined) {
      fromKeyframe.translate = `0 ${target.translateY}px`;
      toKeyframe.translate = 'none';
    }

    const animation = target.element.animate(
      [fromKeyframe, toKeyframe],
      {
        duration: target.durationMs ?? FLOATING_LAYER_ENTER_DURATION_MS,
        easing: target.easing ?? FLOATING_LAYER_ENTER_EASING,
        fill: 'both',
      },
    );
    animation.onfinish = () => {
      animation.onfinish = null;
      remainingAnimations -= 1;
      if (remainingAnimations > 0 || finished) {
        return;
      }

      finished = true;
      for (const runningAnimation of animations) {
        runningAnimation.onfinish = null;
        runningAnimation.cancel();
      }
      onFinish();
    };
    return animation;
  });

  return () => {
    if (finished) {
      return;
    }
    finished = true;
    for (const animation of animations) {
      animation.onfinish = null;
      animation.cancel();
    }
  };
};

export const animateFloatingLayerExit = (
  targets: readonly FloatingLayerExitTarget[],
  onFinish: () => void,
): (() => void) => {
  const interactionSnapshots = targets.map(({ element }) => ({
    element,
    inert: element.inert,
    pointerEvents: element.style.pointerEvents,
  }));
  const restoreInteraction = (): void => {
    for (const snapshot of interactionSnapshots) {
      snapshot.element.inert = snapshot.inert;
      if (snapshot.pointerEvents) {
        snapshot.element.style.pointerEvents = snapshot.pointerEvents;
      } else {
        snapshot.element.style.removeProperty('pointer-events');
      }
    }
  };

  for (const { element } of targets) {
    element.inert = true;
    element.style.pointerEvents = 'none';
  }

  if (targets.length === 0 || shouldReduceFloatingLayerMotion()) {
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

  let remainingAnimations = targets.length;
  let finished = false;
  const animations = targets.map((target) => {
    const computedStyle = window.getComputedStyle(target.element);
    const positionedTransform = computedStyle.transform === 'none'
      ? ''
      : computedStyle.transform;
    const fromKeyframe: Keyframe = { opacity: computedStyle.opacity };
    const toKeyframe: Keyframe = { opacity: '0' };
    if (target.blurPx !== null) {
      fromKeyframe.filter = computedStyle.filter;
      toKeyframe.filter = `blur(${target.blurPx ?? 4}px)`;
    }
    if (target.targetScale !== null) {
      const exitScale = target.targetScale ?? 1.04;
      fromKeyframe.transform = positionedTransform || 'scale(1)';
      toKeyframe.transform = positionedTransform
        ? `${positionedTransform} scale(${exitScale})`
        : `scale(${exitScale})`;
    }
    const animation = target.element.animate(
      [fromKeyframe, toKeyframe],
      {
        duration: target.durationMs ?? FLOATING_LAYER_EXIT_DURATION_MS,
        easing: target.easing ?? FLOATING_LAYER_EXIT_EASING,
        fill: 'forwards',
      },
    );
    animation.onfinish = () => {
      animation.onfinish = null;
      remainingAnimations -= 1;
      if (remainingAnimations > 0 || finished) {
        return;
      }

      finished = true;
      onFinish();
      queueMicrotask(() => {
        for (const completedAnimation of animations) {
          completedAnimation.cancel();
        }
        restoreInteraction();
      });
    };
    return animation;
  });

  return () => {
    if (finished) {
      return;
    }
    finished = true;
    for (const animation of animations) {
      animation.onfinish = null;
      animation.cancel();
    }
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
  const preferredX = options.horizontalAlignment === 'center'
    ? anchorRect.left + (anchorRect.width - size.width) / 2
    : options.horizontalAlignment === 'end'
      ? anchorRect.right - size.width
      : anchorRect.left;

  return {
    x: clamp(
      preferredX,
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
  layerId,
  isActive,
  containsEventTarget,
  onPointerDownOutside,
  onResize,
  onDismissRequest,
}: FloatingLayerDismissHandlers): (() => void) => {
  const handleWindowPointerDown = (event: PointerEvent): void => {
    if (
      !isActive()
      || (layerId && !isTopmostFloatingLayer(layerId))
      || containsEventTarget(event.target)
    ) {
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
    if (
      !isActive()
      || (layerId && !isTopmostFloatingLayer(layerId))
      || containsEventTarget(event.target)
    ) {
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
