export const TOUCH_DRAG_THRESHOLD_PX = 8;

/** Browser rows keep vertical touch scrolling; a horizontal start claims their drag. */
export const hasDragMovement = (
  pointerType: string,
  dx: number,
  dy: number,
  horizontalTouchStart: boolean,
): boolean => pointerType === 'touch'
  ? Math.hypot(dx, dy) >= TOUCH_DRAG_THRESHOLD_PX
    && (!horizontalTouchStart || Math.abs(dx) > Math.abs(dy))
  : Math.abs(dx) + Math.abs(dy) >= 4;

export const TAP_WINDOW_MS = 300;
const DOUBLE_TAP_DISTANCE_PX = 24;

export const isConsecutiveTap = (previous: PointerEvent | null, next: PointerEvent): boolean =>
  previous !== null && previous.pointerType === next.pointerType
  && next.timeStamp - previous.timeStamp <= TAP_WINDOW_MS
  && Math.hypot(next.clientX - previous.clientX, next.clientY - previous.clientY) <= DOUBLE_TAP_DISTANCE_PX;
