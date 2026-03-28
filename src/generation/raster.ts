import { GENERATED_VELOCITY, POLYLINE_STEP, THICKNESS } from '../core/pipeline/constants';
import { distanceToPolylineSquared } from '../core/geometry';
import { buildPathPolyline } from '../core/generators/path';
import { buildScannerPolyline } from '../core/generators/scanner';
import { buildSpiralPolyline } from '../core/generators/spiral';
import { buildWaterdropPolyline } from '../core/generators/waterdrop';
import { normalizeOptionalId } from '../shared/normalize-id';
import type { GeneratorNode } from '../shared/model';
import {
  intersectSpatialRequirements,
  toBounds,
} from './analysis/bounds';
import type { SpatialRequirement } from './analysis/types';
import type { LedTape } from './types';
import { addCellToFrame } from './tape';

const RASTER_LIMIT = 4096;

const normalizeRangeStart = (value: number): number =>
  Math.max(Math.floor(value), -RASTER_LIMIT);

const normalizeRangeEnd = (value: number): number =>
  Math.min(Math.ceil(value), RASTER_LIMIT);

const buildGeneratorPolyline = (
  device: Exclude<GeneratorNode, Extract<GeneratorNode, { kind: 'scanner' }>>,
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

const buildScannerGeneratorPolyline = (
  device: Extract<GeneratorNode, { kind: 'scanner' }>,
  beat01: number,
  executionBounds: SpatialRequirement,
) => {
  const renderBounds = toBounds(executionBounds);
  if (!renderBounds) {
    return null;
  }

  // Scanner geometry is defined only inside the requested output extent.
  return buildScannerPolyline(
    device.id,
    device.params,
    beat01,
    POLYLINE_STEP,
    GENERATED_VELOCITY,
    renderBounds,
  );
};

export const rasterizeGeneratorFrame = (
  tape: LedTape,
  frameIndex: number,
  device: GeneratorNode,
  writeOrder: number,
  executionBounds: SpatialRequirement,
): void => {
  const beat = frameIndex * tape.sampleStepBeats;
  const polyline = device.kind === 'scanner'
    ? buildScannerGeneratorPolyline(device, Math.min(Math.max(beat, 0), 1), executionBounds)
    : buildGeneratorPolyline(device, Math.min(Math.max(beat, 0), 1));
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

  const rasterBounds = toBounds(intersectSpatialRequirements(
    {
      minX: minX - THICKNESS,
      maxX: maxX + THICKNESS,
      minY: minY - THICKNESS,
      maxY: maxY + THICKNESS,
    },
    executionBounds,
  ));
  if (!rasterBounds) {
    return;
  }

  const startX = normalizeRangeStart(rasterBounds.minX);
  const endX = normalizeRangeEnd(rasterBounds.maxX);
  const startY = normalizeRangeStart(rasterBounds.minY);
  const endY = normalizeRangeEnd(rasterBounds.maxY);
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
