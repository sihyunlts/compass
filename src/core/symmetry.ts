import type { AffineTransform, Vec2 } from './core-types';
import { toMirrorTransformAt, toRotateTransformAt } from './geometry';

type SymmetryMode = 'reflection' | 'rotation';

export const MIN_SYMMETRY_RESULT_COUNT = 2;
export const MAX_SYMMETRY_RESULT_COUNT = 16;

interface SymmetryPlanInput {
  mode: SymmetryMode;
  sourceScope: 'sector' | 'entire';
  count: number;
  directionDeg: number;
  center: Vec2;
}

interface SymmetryTransformStep {
  transform: AffineTransform | null;
  targetAngleDeg: number;
}

interface SymmetryTransformPlan {
  count: number;
  sectorWidthDeg: number;
  divisionAnglesDeg: readonly number[];
  steps: readonly SymmetryTransformStep[];
}

export const normalizeSymmetryAngle = (angleDeg: number): number => {
  const normalized = angleDeg % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

export const resolveSymmetryResultCount = (
  mode: SymmetryMode,
  value: number,
): number => {
  const bounded = Math.min(
    Math.max(Math.round(value), MIN_SYMMETRY_RESULT_COUNT),
    MAX_SYMMETRY_RESULT_COUNT,
  );
  return mode === 'reflection' ? Math.round(bounded / 2) * 2 : bounded;
};

export const buildSymmetryTransformPlan = (
  input: SymmetryPlanInput,
): SymmetryTransformPlan => {
  const count = resolveSymmetryResultCount(input.mode, input.count);
  const sourceDirectionDeg = input.sourceScope === 'sector'
    ? normalizeSymmetryAngle(input.directionDeg)
    : 0;
  const sectorWidthDeg = 360 / count;
  const divisionAnglesDeg = Array.from(
    { length: count },
    (_, index) => normalizeSymmetryAngle(
      sourceDirectionDeg + sectorWidthDeg / 2 + index * sectorWidthDeg,
    ),
  );
  const steps = Array.from({ length: count }, (_, index): SymmetryTransformStep => {
    const targetAngleDeg = normalizeSymmetryAngle(sourceDirectionDeg + index * sectorWidthDeg);
    if (input.mode === 'rotation') {
      const transformAngleDeg = index * sectorWidthDeg;
      return {
        transform: transformAngleDeg === 0
          ? null
          : toRotateTransformAt(transformAngleDeg, input.center),
        targetAngleDeg,
      };
    }

    if (index === 0) {
      return {
        transform: null,
        targetAngleDeg,
      };
    }

    if (index % 2 === 1) {
      const axisAngleDeg = sourceDirectionDeg + index * sectorWidthDeg / 2;
      return {
        transform: toMirrorTransformAt(axisAngleDeg, input.center),
        targetAngleDeg,
      };
    }

    return {
      transform: toRotateTransformAt(index * sectorWidthDeg, input.center),
      targetAngleDeg,
    };
  });

  return {
    count,
    sectorWidthDeg,
    divisionAnglesDeg,
    steps,
  };
};

export const isPointInSymmetrySector = (
  x: number,
  y: number,
  center: Vec2,
  sectorCenterAngleDeg: number,
  sectorWidthDeg: number,
): boolean => {
  const offsetX = x - center.x;
  const offsetY = y - center.y;
  if (Math.abs(offsetX) < 1e-9 && Math.abs(offsetY) < 1e-9) {
    return true;
  }

  const pointAngleDeg = normalizeSymmetryAngle(
    Math.atan2(offsetY, offsetX) * 180 / Math.PI,
  );
  const deltaDeg = (
    (pointAngleDeg - normalizeSymmetryAngle(sectorCenterAngleDeg) + 540) % 360
  ) - 180;
  return Math.abs(deltaDeg) <= sectorWidthDeg / 2 + 1e-9;
};
