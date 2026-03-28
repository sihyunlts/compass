import { GENERATED_VELOCITY, POLYLINE_STEP, THICKNESS, buildWorldBounds } from '../core/pipeline/constants';
import { distanceToPolylineSquared } from '../core/geometry';
import { buildPathPolyline } from '../core/generators/path';
import { buildScannerPolyline } from '../core/generators/scanner';
import { buildSpiralPolyline } from '../core/generators/spiral';
import { buildWaterdropPolyline } from '../core/generators/waterdrop';
import { normalizeOptionalId } from '../shared/normalize-id';
import type { GeneratorNode } from '../shared/model';
import type { LedTape } from './types';
import { addCellToFrame } from './tape';

const TILE_MIN = 0;
const TILE_MAX = 9;
const TILE_COUNT = 10;
const RASTER_LIMIT = 4096;

export const toRoundedCoordinateKey = (
  x: number,
  y: number,
): string | null => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return `${Math.round(x)},${Math.round(y)}`;
};

export const toRoundedTileId = (
  x: number,
  y: number,
): number | null => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  const tileX = Math.round(x);
  const tileY = Math.round(y);
  if (tileX < TILE_MIN || tileX > TILE_MAX || tileY < TILE_MIN || tileY > TILE_MAX) {
    return null;
  }

  return tileY * TILE_COUNT + tileX;
};

const normalizeRangeStart = (value: number): number =>
  Math.max(Math.floor(value), -RASTER_LIMIT);

const normalizeRangeEnd = (value: number): number =>
  Math.min(Math.ceil(value), RASTER_LIMIT);

const buildGeneratorPolyline = (
  device: GeneratorNode,
  beat01: number,
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
    return buildScannerPolyline(
      device.id,
      device.params,
      beat01,
      POLYLINE_STEP,
      GENERATED_VELOCITY,
      buildWorldBounds(),
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
): void => {
  const beat = frameIndex * tape.sampleStepBeats;
  const polyline = buildGeneratorPolyline(device, Math.min(Math.max(beat, 0), 1));
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
