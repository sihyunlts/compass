import { clampBounds } from '../../core/geometry';
import type { Bounds } from '../../core/core-types';
import type { SpatialBounds, SpatialRequirement } from './types';

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

export const toBounds = (
  requirement: SpatialRequirement,
): Bounds | null => {
  if (requirement === 'all' || requirement === 'none') {
    return null;
  }

  return {
    minX: requirement.minX,
    maxX: requirement.maxX,
    minY: requirement.minY,
    maxY: requirement.maxY,
  };
};
