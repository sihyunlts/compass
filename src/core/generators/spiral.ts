import type { Polyline, Vec2 } from '../core-types';
import type { SpiralParams } from '../../shared/model';

const SPIRAL_TRAVEL_SPAN = 18;
const SPIRAL_STRIDE = 4.5;

export const buildSpiralPolyline = (
  originId: string,
  params: SpiralParams,
  t01: number,
  step: number,
  velocity: number,
): Polyline | null => {
  if (!Number.isFinite(params.centerX)
    || !Number.isFinite(params.centerY)
    || !Number.isFinite(params.turns)
    || !Number.isFinite(params.startRadius)
    || !Number.isFinite(t01)) {
    return null;
  }

  const center = { x: params.centerX, y: params.centerY };
  const targetDistance = params.startRadius + t01 * SPIRAL_TRAVEL_SPAN;
  if (!Number.isFinite(targetDistance)) {
    return null;
  }

  const angleSteps = Math.max(24, Math.ceil((Math.PI * 2 * Math.max(0.5, Math.abs(targetDistance))) / Math.max(step, 0.01)));
  const points: Vec2[] = [];

  for (let i = 0; i < angleSteps; i += 1) {
    const angle01 = i / angleSteps;
    const angle = angle01 * Math.PI * 2;
    const radius = targetDistance - angle01 * params.turns * SPIRAL_STRIDE;
    if (!Number.isFinite(radius)) {
      continue;
    }
    if (radius < 0) {
      if (points.length === 1) {
        points.push({ x: center.x, y: center.y });
      }
      break;
    }
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    points.push({ x, y });
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
