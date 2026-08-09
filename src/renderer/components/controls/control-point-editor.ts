export const CONTROL_POINT_DRAG_THRESHOLD_PX = 4;
export const CONTROL_POINT_SOFT_SNAP_DISTANCE_PX = 10;

export const hasExceededControlPointDragThreshold = (
  clientX: number,
  clientY: number,
  startClientX: number,
  startClientY: number,
): boolean => Math.abs(clientX - startClientX) > CONTROL_POINT_DRAG_THRESHOLD_PX
  || Math.abs(clientY - startClientY) > CONTROL_POINT_DRAG_THRESHOLD_PX;

export const toSoftSnappedValue = (
  value: number,
  snapPoints: ReadonlyArray<number>,
  spanPx: number,
): number => {
  if (snapPoints.length === 0 || !Number.isFinite(spanPx) || spanPx <= 0) {
    return value;
  }

  const threshold = CONTROL_POINT_SOFT_SNAP_DISTANCE_PX / spanPx;
  let nearest = value;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const snapPoint of snapPoints) {
    const distance = Math.abs(value - snapPoint);
    if (distance < nearestDistance) {
      nearest = snapPoint;
      nearestDistance = distance;
    }
  }
  return nearestDistance <= threshold ? nearest : value;
};
