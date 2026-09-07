import type { Bounds, Polyline, Vec2 } from '../core-types';
import type { ScannerParams } from '../../shared/model';
import { COMPOSITION_BOUNDS, toAxisBasis } from '../geometry';

const SCAN_TRAVEL_PADDING = 0.5;
const SCAN_POSITION_TIE_BREAK = 1e-6;

const projectOnAxis = (point: Vec2, axis: Vec2): number => point.x * axis.x + point.y * axis.y;

export const buildScannerPolyline = (
  originId: string,
  params: ScannerParams,
  t01: number,
  velocity: number,
  bounds: Bounds,
): Polyline | null => {
  if (!Number.isFinite(params.angleDeg)
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

  for (const corner of corners) {
    const projAxis = projectOnAxis(corner, axis);
    if (projAxis < minAxis) minAxis = projAxis;
    if (projAxis > maxAxis) maxAxis = projAxis;
  }

  if (!Number.isFinite(minAxis) || !Number.isFinite(maxAxis)) {
    return null;
  }

  const scanStart = minAxis - SCAN_TRAVEL_PADDING;
  const scanEnd = maxAxis + SCAN_TRAVEL_PADDING;
  const travelRange = scanEnd - scanStart;
  if (!Number.isFinite(travelRange) || travelRange <= 0) {
    return null;
  }

  const scanPos = scanStart + t01 * travelRange + SCAN_POSITION_TIE_BREAK;
  if (!Number.isFinite(scanPos)) {
    return null;
  }

  const referenceCenter = projectOnAxis({
    x: (COMPOSITION_BOUNDS.minX + COMPOSITION_BOUNDS.maxX) / 2,
    y: (COMPOSITION_BOUNDS.minY + COMPOSITION_BOUNDS.maxY) / 2,
  }, perp);
  const referenceHalfSpan = (
    Math.abs(perp.x) * (COMPOSITION_BOUNDS.maxX - COMPOSITION_BOUNDS.minX)
    + Math.abs(perp.y) * (COMPOSITION_BOUNDS.maxY - COMPOSITION_BOUNDS.minY)
  ) / 2;

  return {
    extent: 'line',
    points: [referenceCenter - referenceHalfSpan, referenceCenter + referenceHalfSpan]
      .map((s) => ({ x: axis.x * scanPos + perp.x * s, y: axis.y * scanPos + perp.y * s })),
    closed: false,
    originId,
    velocity,
    rasterMode: 'centerline',
  };
};
