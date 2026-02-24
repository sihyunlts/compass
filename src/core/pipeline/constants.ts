import type { Bounds } from '../core-types';
import { COMPOSITION_CENTER, clampBounds } from '../geometry';

export const SAMPLES_PER_BEAT = 64;
export const POLYLINE_STEP = 1;
export const THICKNESS = 0.5;
export const TILE_MIN = 0;
export const TILE_MAX = 9;
export const TILE_COUNT = 10;
export const GENERATED_VELOCITY = 3;
export const MIN_NOTE_DURATION = 1 / 4096;

export const buildWorldBounds = (): Bounds => {
  const halfDiagonal = Math.hypot(COMPOSITION_CENTER.x, COMPOSITION_CENTER.y);
  const margin = THICKNESS + POLYLINE_STEP * 2;
  const radius = halfDiagonal + margin;
  return clampBounds({
    minX: COMPOSITION_CENTER.x - radius,
    maxX: COMPOSITION_CENTER.x + radius,
    minY: COMPOSITION_CENTER.y - radius,
    maxY: COMPOSITION_CENTER.y + radius,
  });
};
