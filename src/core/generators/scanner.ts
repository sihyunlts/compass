import type { Bounds, Polyline, Vec2 } from '../core-types';
import type { ScannerParams } from '../../shared/model';
import { toAxisBasis } from '../geometry';

const SCAN_TRAVEL_PADDING = 0.5;

const projectOnAxis = (point: Vec2, axis: Vec2): number => point.x * axis.x + point.y * axis.y;

export const buildScannerPolyline = (
  originId: string,
  params: ScannerParams,
  t01: number,
  step: number,
  velocity: number,
  bounds: Bounds,
): Polyline | null => {
  if (!Number.isFinite(params.angleDeg)
    || !Number.isFinite(params.startOffset)
    || !Number.isFinite(t01)) {
    return null;
  }

  const basis = toAxisBasis(params.angleDeg);
  if (!Number.isFinite(basis.axisX) || !Number.isFinite(basis.axisY)) {
    return null;
  }

  const axis = { x: basis.axisX, y: basis.axisY };
  const perp = { x: basis.perpX, y: basis.perpY };

  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
  ];

  let minAxis = Number.POSITIVE_INFINITY;
  let maxAxis = Number.NEGATIVE_INFINITY;
  let minPerp = Number.POSITIVE_INFINITY;
  let maxPerp = Number.NEGATIVE_INFINITY;

  for (const corner of corners) {
    const projAxis = projectOnAxis(corner, axis);
    const projPerp = projectOnAxis(corner, perp);
    if (projAxis < minAxis) minAxis = projAxis;
    if (projAxis > maxAxis) maxAxis = projAxis;
    if (projPerp < minPerp) minPerp = projPerp;
    if (projPerp > maxPerp) maxPerp = projPerp;
  }

  if (!Number.isFinite(minAxis) || !Number.isFinite(maxAxis)
    || !Number.isFinite(minPerp) || !Number.isFinite(maxPerp)) {
    return null;
  }

  const scanStart = minAxis - SCAN_TRAVEL_PADDING + params.startOffset;
  const scanEnd = maxAxis + SCAN_TRAVEL_PADDING + params.startOffset;
  const travelRange = scanEnd - scanStart;
  if (!Number.isFinite(travelRange) || travelRange <= 0) {
    return null;
  }

  const scanPos = scanStart + t01 * travelRange;
  if (!Number.isFinite(scanPos)) {
    return null;
  }

  const points: Vec2[] = [];
  const span = maxPerp - minPerp;
  const count = Math.max(2, Math.ceil(span / Math.max(step, 0.01)));
  for (let i = 0; i < count; i += 1) {
    const s = minPerp + (i / (count - 1)) * span;
    const x = axis.x * scanPos + perp.x * s;
    const y = axis.y * scanPos + perp.y * s;
    points.push({ x, y });
  }

  return {
    points,
    closed: false,
    originId,
    velocity,
  };
};
