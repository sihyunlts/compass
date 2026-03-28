import { GENERATED_VELOCITY, POLYLINE_STEP, THICKNESS } from '../core/pipeline/constants';
import { distanceToPolylineSquared } from '../core/geometry';
import { buildPathPolyline } from '../core/generators/path';
import { buildScannerPolyline } from '../core/generators/scanner';
import { buildSpiralPolyline } from '../core/generators/spiral';
import { buildWaterdropPolyline } from '../core/generators/waterdrop';
import { normalizeOptionalId } from '../shared/normalize-id';
import type { GeneratorNode } from '../shared/model';
import type { CanonicalSpatialAdapter, LedTape } from './types';
import { addCellToFrame } from './tape';

const RASTER_LIMIT = 4096;

const normalizeRangeStart = (value: number): number =>
  Math.max(Math.floor(value), -RASTER_LIMIT);

const normalizeRangeEnd = (value: number): number =>
  Math.min(Math.ceil(value), RASTER_LIMIT);

const buildGeneratorPolyline = (
  device: GeneratorNode,
  beat01: number,
  spatialAdapter: CanonicalSpatialAdapter,
) => {
  if (device.kind === 'waterdrop') {
    return buildWaterdropPolyline(
      device.id,
      device.params,
      beat01,
      POLYLINE_STEP,
      GENERATED_VELOCITY,
    );
  }

  if (device.kind === 'scanner') {
    const renderBounds = spatialAdapter.resolveGeneratorRenderBounds(device);
    if (!renderBounds) {
      return null;
    }

    return buildScannerPolyline(
      device.id,
      device.params,
      beat01,
      POLYLINE_STEP,
      GENERATED_VELOCITY,
      renderBounds,
    );
  }

  if (device.kind === 'spiral') {
    return buildSpiralPolyline(
      device.id,
      device.params,
      beat01,
      POLYLINE_STEP,
      GENERATED_VELOCITY,
    );
  }

  return buildPathPolyline(
    device.id,
    device.params,
    GENERATED_VELOCITY,
  );
};

export const rasterizeGeneratorFrame = (
  tape: LedTape,
  frameIndex: number,
  device: GeneratorNode,
  writeOrder: number,
  spatialAdapter: CanonicalSpatialAdapter,
): void => {
  const beat = frameIndex * tape.sampleStepBeats;
  const polyline = buildGeneratorPolyline(device, Math.min(Math.max(beat, 0), 1), spatialAdapter);
  if (!polyline || polyline.points.length === 0) {
    return;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of polyline.points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return;
  }

  const startX = normalizeRangeStart(minX - THICKNESS);
  const endX = normalizeRangeEnd(maxX + THICKNESS);
  const startY = normalizeRangeStart(minY - THICKNESS);
  const endY = normalizeRangeEnd(maxY + THICKNESS);
  const thicknessSq = THICKNESS * THICKNESS;
  const originGroupId = normalizeOptionalId(device.groupId);

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      if (distanceToPolylineSquared({ x, y }, polyline) > thicknessSq) {
        continue;
      }

      addCellToFrame(tape, frameIndex, {
        x,
        y,
        velocity: polyline.velocity,
        originId: device.id,
        originGroupId,
        writeOrder,
      });
    }
  }
};
