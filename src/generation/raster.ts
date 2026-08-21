import { GENERATED_VELOCITY, POLYLINE_STEP } from '../core/pipeline/constants';
import type { Polyline } from '../core/core-types';
import { COMPOSITION_BOUNDS } from '../core/geometry';
import { buildPathPolyline } from '../core/generators/path';
import { buildRainPolylines } from '../core/generators/rain';
import { buildScannerPolyline } from '../core/generators/scanner';
import { buildSpiralPolyline } from '../core/generators/spiral';
import { buildRipplePolyline } from '../core/generators/ripple';
import { normalizeOptionalId } from '../shared/normalize-id';
import type { GeneratorNode } from '../shared/model';
import { toBounds } from './analysis/bounds';
import type { SpatialRequirement } from './analysis/types';
import type { GeometryTimeline } from './types';
import {
  addStrokeToFrame,
} from './timeline';

const NORMALIZED_GENERATOR_END_BEAT = 1;
// Unequal components keep common diagonal transforms from erasing the tie
// direction on either grid axis.
const CENTERLINE_POINT_TIE_BREAK_DIRECTION = Object.freeze({
  x: 1,
  y: Math.SQRT2,
});

const toInclusiveFrameProgress = (
  beat: number,
  sampleStepBeats: number,
): number => {
  const lastFrameBeat = NORMALIZED_GENERATOR_END_BEAT - sampleStepBeats;
  return lastFrameBeat <= 0 ? 0 : Math.min(Math.max(beat / lastFrameBeat, 0), 1);
};

const toPolylineArray = (
  polyline: Polyline | null,
): Polyline[] => polyline ? [polyline] : [];

const withCenterlinePointTieBreakDirection = (
  polyline: Polyline,
): Polyline => (
  polyline.rasterMode === 'centerline'
  && polyline.points.length === 1
  && !polyline.rasterTieBreakDirection
    ? {
        ...polyline,
        // Transform this direction with the point so symmetric copies choose
        // complementary grid cells when a coordinate lies exactly halfway.
        rasterTieBreakDirection: CENTERLINE_POINT_TIE_BREAK_DIRECTION,
      }
    : polyline
);

const buildScannerGeneratorPolyline = (
  device: Extract<GeneratorNode, { kind: 'scanner' }>,
  beat01: number,
  evaluationBounds: SpatialRequirement,
): Polyline | null => {
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

const buildGeneratorPolylines = (
  device: GeneratorNode,
  beat01: number,
  sampleStepBeats: number,
  evaluationBounds: SpatialRequirement,
): Polyline[] => {
  if (device.kind === 'ripple') {
    return toPolylineArray(
      buildRipplePolyline(
        device.id,
        device.params,
        beat01,
        POLYLINE_STEP,
        GENERATED_VELOCITY,
      ),
    );
  }

  if (device.kind === 'scanner') {
    return toPolylineArray(
      buildScannerGeneratorPolyline(device, beat01, evaluationBounds),
    );
  }

  if (device.kind === 'rain') {
    return buildRainPolylines(
      device.id,
      device.params,
      beat01,
      sampleStepBeats,
      GENERATED_VELOCITY,
      COMPOSITION_BOUNDS,
    );
  }

  if (device.kind === 'spiral') {
    return toPolylineArray(
      buildSpiralPolyline(
        device.id,
        device.params,
        beat01,
        POLYLINE_STEP,
        GENERATED_VELOCITY,
      ),
    );
  }

  return toPolylineArray(
    buildPathPolyline(
      device.id,
      device.params,
      device.params.closed
        ? beat01
        : toInclusiveFrameProgress(beat01, sampleStepBeats),
      GENERATED_VELOCITY,
    ),
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
  const polylines = buildGeneratorPolylines(
    device,
    device.kind === 'rain'
      ? Math.max(beat, 0)
      : Math.min(Math.max(beat, 0), NORMALIZED_GENERATOR_END_BEAT),
    timeline.sampleStepBeats,
    evaluationBounds,
  );

  for (const polyline of polylines) {
    if (polyline.points.length === 0) {
      continue;
    }

    addStrokeToFrame(timeline, frameIndex, {
      polyline: withCenterlinePointTieBreakDirection(polyline),
      originGroupId: normalizeOptionalId(device.groupId),
      writeOrder,
    });
  }
};
