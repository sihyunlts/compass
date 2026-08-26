export const toRoundedCoordinateKey = (
  x: number,
  y: number,
): string | null => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return `${Math.round(x)},${Math.round(y)}`;
};

const COORDINATE_BOUNDARY_EPSILON = 1e-9;

const resolveNearestCoordinateValues = (
  value: number,
): readonly number[] => {
  const rounded = Math.round(value);
  const lower = Math.floor(value);
  return Math.abs(value - (lower + 0.5)) <= COORDINATE_BOUNDARY_EPSILON
    ? [lower, rounded]
    : [rounded];
};

export const coordinateKeySetContainsPoint = (
  coordinateKeys: ReadonlySet<string>,
  x: number,
  y: number,
): boolean => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return false;
  }

  const candidateXs = resolveNearestCoordinateValues(x);
  const candidateYs = resolveNearestCoordinateValues(y);
  return candidateXs.some((candidateX) => candidateYs.some(
    (candidateY) => coordinateKeys.has(`${candidateX},${candidateY}`),
  ));
};
