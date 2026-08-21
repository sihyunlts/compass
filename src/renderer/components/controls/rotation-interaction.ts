type RotationCursor = 'ne-resize' | 'se-resize' | 'sw-resize' | 'nw-resize';

interface RotationSnapInput {
  requestedRadians: number;
  radiusPx: number;
  lockToIncrement: boolean;
  snapEnabled: boolean;
}

interface RotationSnapResult {
  radians: number;
  snapped: boolean;
}

const ROTATION_SNAP_DISTANCE_PX = 4;
const SOFT_ROTATION_SNAP_RADIANS = Math.PI / 4;
const MAX_SOFT_ROTATION_DISTANCE_RADIANS = Math.PI / 60;
const LOCKED_ROTATION_SNAP_RADIANS = Math.PI / 12;

export const resolveRotationCursor = (
  offsetX: number,
  offsetY: number,
): RotationCursor => {
  if (offsetY < 0) {
    return offsetX < 0 ? 'ne-resize' : 'se-resize';
  }
  return offsetX < 0 ? 'nw-resize' : 'sw-resize';
};

export const resolveRotationSnap = (
  input: RotationSnapInput,
): RotationSnapResult => {
  if (input.lockToIncrement) {
    return {
      radians: Math.round(input.requestedRadians / LOCKED_ROTATION_SNAP_RADIANS)
        * LOCKED_ROTATION_SNAP_RADIANS,
      snapped: true,
    };
  }

  if (!input.snapEnabled) {
    return { radians: input.requestedRadians, snapped: false };
  }

  const candidate = Math.round(input.requestedRadians / SOFT_ROTATION_SNAP_RADIANS)
    * SOFT_ROTATION_SNAP_RADIANS;
  const angularDistance = Math.abs(input.requestedRadians - candidate);
  if (
    angularDistance <= MAX_SOFT_ROTATION_DISTANCE_RADIANS
    && angularDistance * input.radiusPx <= ROTATION_SNAP_DISTANCE_PX
  ) {
    return { radians: candidate, snapped: true };
  }

  return { radians: input.requestedRadians, snapped: false };
};
