import { applyAffine, clampBounds } from '../../core/geometry';
import type { AffineTransform, Bounds } from '../../core/core-types';
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

export const unionSpatialRequirements = (
  left: SpatialRequirement,
  right: SpatialRequirement,
): SpatialRequirement => {
  if (left === 'all' || right === 'all') {
    return 'all';
  }

  if (left === 'none') {
    return right;
  }

  if (right === 'none') {
    return left;
  }

  return createSpatialBounds(
    Math.min(left.minX, right.minX),
    Math.max(left.maxX, right.maxX),
    Math.min(left.minY, right.minY),
    Math.max(left.maxY, right.maxY),
  );
};

export const transformSpatialRequirement = (
  requirement: SpatialRequirement,
  transform: AffineTransform,
): SpatialRequirement => {
  if (requirement === 'all' || requirement === 'none') {
    return requirement;
  }

  const corners = [
    applyAffine(transform, { x: requirement.minX, y: requirement.minY }),
    applyAffine(transform, { x: requirement.minX, y: requirement.maxY }),
    applyAffine(transform, { x: requirement.maxX, y: requirement.minY }),
    applyAffine(transform, { x: requirement.maxX, y: requirement.maxY }),
  ];

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const corner of corners) {
    if (corner.x < minX) minX = corner.x;
    if (corner.x > maxX) maxX = corner.x;
    if (corner.y < minY) minY = corner.y;
    if (corner.y > maxY) maxY = corner.y;
  }

  return createSpatialBounds(minX, maxX, minY, maxY);
};

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
