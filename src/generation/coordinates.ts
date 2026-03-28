export const toRoundedCoordinateKey = (
  x: number,
  y: number,
): string | null => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return `${Math.round(x)},${Math.round(y)}`;
};
