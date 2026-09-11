import { clampBounds } from '../../core/geometry';
import type { SpatialBounds } from './types';

export const createSpatialBounds = (
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): SpatialBounds => clampBounds({
  minX,
  maxX,
  minY,
  maxY,
});
