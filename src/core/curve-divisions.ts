import { clamp } from '../shared/math';

const MIN_CURVE_DIVISIONS = 2;
const MAX_CURVE_DIVISIONS = 64;
export const DEFAULT_CURVE_DIVISIONS = 16;

export const CURVE_DIVISION_OPTIONS = [4, 8, 16, 32, 64] as const;

export const sanitizeCurveDivisions = (value: unknown): number => {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) {
    return DEFAULT_CURVE_DIVISIONS;
  }

  return clamp(numeric, MIN_CURVE_DIVISIONS, MAX_CURVE_DIVISIONS);
};
