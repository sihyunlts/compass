import type { Polyline } from '../core-types';
import type { PathParams } from '../../shared/model';

export const buildPathPolyline = (
  originId: string,
  params: PathParams,
  velocity: number,
): Polyline | null => {
  if (!Array.isArray(params.points) || params.points.length < 2) {
    return null;
  }

  const points = [];
  for (const point of params.points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return null;
    }
    points.push({
      x: point.x,
      y: point.y,
    });
  }

  if (points.length < 2) {
    return null;
  }

  return {
    points,
    closed: false,
    originId,
    velocity,
    clipStack: [],
  };
};
