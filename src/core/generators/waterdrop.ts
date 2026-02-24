import type { Polyline, Vec2 } from '../core-types';
import type { WaterdropParams } from '../../shared/types';

const RING_TRAVEL_SPAN = 18;

const toSuperellipsePoint = (
  center: Vec2,
  radius: number,
  curvature: number,
  angle: number,
): Vec2 => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const exp = 2 / curvature;
  const x = Math.sign(cos) * Math.pow(Math.abs(cos), exp) * radius;
  const y = Math.sign(sin) * Math.pow(Math.abs(sin), exp) * radius;
  return { x: center.x + x, y: center.y + y };
};

export const buildWaterdropPolyline = (
  originId: string,
  params: WaterdropParams,
  t01: number,
  step: number,
  velocity: number,
): Polyline | null => {
  if (!Number.isFinite(params.centerX)
    || !Number.isFinite(params.centerY)
    || !Number.isFinite(params.curvature)
    || !Number.isFinite(params.startRadius)) {
    return null;
  }
  if (!Number.isFinite(t01)) {
    return null;
  }

  const curvature = params.curvature;
  if (curvature <= 0) {
    return null;
  }

  const radius = params.startRadius + t01 * RING_TRAVEL_SPAN;
  if (!Number.isFinite(radius)) {
    return null;
  }

  const center = { x: params.centerX, y: params.centerY };
  const circumference = Math.max(0.01, 2 * Math.PI * Math.max(0.5, Math.abs(radius)));
  const segmentCount = Math.max(12, Math.ceil(circumference / Math.max(step, 0.01)));
  const points: Vec2[] = [];

  for (let i = 0; i < segmentCount; i += 1) {
    const angle = (i / segmentCount) * Math.PI * 2;
    points.push(toSuperellipsePoint(center, radius, curvature, angle));
  }

  return {
    points,
    closed: true,
    originId,
    velocity,
  };
};
