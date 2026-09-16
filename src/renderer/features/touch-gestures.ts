import { TOUCH_DRAG_THRESHOLD_PX, TAP_WINDOW_MS, isConsecutiveTap } from './drag-gesture';

type TouchGestureOptions = { enabled?: boolean; contextMenu?: boolean };

/** Routes touch holds and double taps through the existing contextmenu/dblclick handlers. */
export const touchGestures = (node: HTMLElement | SVGElement, options: TouchGestureOptions = {}) => {
  node.setAttribute('data-touch-gestures', '');
  const lifetime = new AbortController();
  let gesture: AbortController | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let previousTap: PointerEvent | null = null;
  let tapExpiry: ReturnType<typeof setTimeout> | null = null;
  let pendingTap: AbortController | null = null;
  let ownsTouch = false;
  let suppressClick = false;
  let opened = false;

  const clearTap = (): void => {
    if (tapExpiry !== null) clearTimeout(tapExpiry);
    tapExpiry = null;
    pendingTap?.abort();
    pendingTap = null;
    previousTap = null;
  };
  const finish = (): void => {
    if (holdTimer !== null) clearTimeout(holdTimer);
    holdTimer = null;
    gesture?.abort();
    gesture = null;
  };
  const cancel = (): void => {
    finish();
    clearTap();
  };
  const dispatch = (type: 'contextmenu' | 'dblclick', event: PointerEvent): void => {
    node.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true,
      clientX: event.clientX, clientY: event.clientY,
      button: type === 'contextmenu' ? 2 : 0,
      detail: type === 'dblclick' ? 2 : 0,
    }));
  };
  const isGestureTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element) || target.closest('[data-touch-gestures]') !== node) return false;
    const control = target.closest('button, input, select, textarea, a, [role="tab"]');
    return !control || control === node;
  };
  const down = (event: PointerEvent): void => {
    finish();
    ownsTouch = options.enabled !== false && event.pointerType === 'touch'
      && event.isPrimary && isGestureTarget(event.target);
    suppressClick = false;
    opened = false;
    if (!ownsTouch) { clearTap(); return; }
    gesture = new AbortController();
    const { signal } = gesture;
    window.addEventListener('pointermove', (move) => {
      if (move.pointerId === event.pointerId
        && Math.hypot(move.clientX - event.clientX, move.clientY - event.clientY) >= TOUCH_DRAG_THRESHOLD_PX) {
        suppressClick = true;
        cancel();
      }
    }, { signal });
    window.addEventListener('pointercancel', (end) => {
      if (end.pointerId === event.pointerId) cancel();
    }, { signal });
    window.addEventListener('blur', cancel, { signal });
    window.addEventListener('pointerup', (end) => {
      if (end.pointerId !== event.pointerId) return;
      finish();
      if (opened || end.timeStamp - event.timeStamp > TAP_WINDOW_MS) { clearTap(); return; }
      const matches = isConsecutiveTap(previousTap, end);
      clearTap();
      if (matches) {
        suppressClick = true;
        dispatch('dblclick', end);
      } else {
        previousTap = end;
        pendingTap = new AbortController();
        window.addEventListener('pointerdown', (next) => {
          if (!next.isPrimary || next.pointerType !== 'touch' || !isGestureTarget(next.target)) clearTap();
        }, { capture: true, signal: pendingTap.signal });
        window.addEventListener('blur', clearTap, { signal: pendingTap.signal });
        tapExpiry = setTimeout(clearTap, TAP_WINDOW_MS);
      }
    }, { signal });
    if (options.contextMenu !== false) {
      holdTimer = setTimeout(() => {
        holdTimer = null;
        dispatch('contextmenu', event);
      }, 500);
    }
  };
  const { signal } = lifetime;
  node.addEventListener('pointerdown', down, { signal });
  node.addEventListener('contextmenu', (event) => {
    if (!ownsTouch || !isGestureTarget(event.target)) return;
    if (holdTimer !== null) clearTimeout(holdTimer);
    holdTimer = null;
    clearTap();
    suppressClick = true;
    if (opened) { event.preventDefault(); event.stopImmediatePropagation(); }
    opened = true;
  }, { capture: true, signal });
  node.addEventListener('dblclick', (event) => {
    if (ownsTouch && event.isTrusted && isGestureTarget(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, { capture: true, signal });
  node.addEventListener('click', (event) => {
    if (!suppressClick || !isGestureTarget(event.target)) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true, signal });
  return {
    update(value: TouchGestureOptions) {
      options = value;
      if (options.enabled === false) cancel();
    },
    destroy() { cancel(); lifetime.abort(); node.removeAttribute('data-touch-gestures'); },
  };
};
