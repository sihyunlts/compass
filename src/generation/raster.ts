import { GENERATED_VELOCITY, POLYLINE_STEP } from '../core/pipeline/constants';
import { buildPathPolyline } from '../core/generators/path';
import { buildScannerPolyline } from '../core/generators/scanner';
import { buildSpiralPolyline } from '../core/generators/spiral';
import { buildWaterdropPolyline } from '../core/generators/waterdrop';
import { normalizeOptionalId } from '../shared/normalize-id';
import type { GeneratorNode } from '../shared/model';
import { toBounds } from './analysis/bounds';
import type { SpatialRequirement } from './analysis/types';
import type { GeometryTimeline } from './types';
import { addStrokeToFrame } from './timeline';

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
  evaluationBounds: SpatialRequirement,
) => {
  const bounds = toBounds(evaluationBounds);
  if (!bounds) {
    return null;
  }

  return buildScannerPolyline(
    device.id,
    device.params,
    beat01,
    POLYLINE_STEP,
    GENERATED_VELOCITY,
    bounds,
  );
};

export const rasterizeGeneratorFrame = (
  timeline: GeometryTimeline,
  frameIndex: number,
  device: GeneratorNode,
  writeOrder: number,
  evaluationBounds: SpatialRequirement,
): void => {
  const beat = frameIndex * timeline.sampleStepBeats;
  const polyline = device.kind === 'scanner'
    ? buildScannerGeneratorPolyline(device, Math.min(Math.max(beat, 0), 1), evaluationBounds)
    : buildGeneratorPolyline(device, Math.min(Math.max(beat, 0), 1));
  if (!polyline || polyline.points.length === 0) {
    return;
  }

  addStrokeToFrame(timeline, frameIndex, {
    polyline,
    originGroupId: normalizeOptionalId(device.groupId),
    writeOrder,
  });
};
