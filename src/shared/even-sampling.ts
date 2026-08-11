export const resolveEvenlySpacedSampleIndices = (
  sourceItemCount: number,
  requestedSampleCount: number,
): number[] => {
  const itemCount = Number.isFinite(sourceItemCount)
    ? Math.max(0, Math.floor(sourceItemCount))
    : 0;
  if (itemCount === 0) {
    return [];
  }

  const safeRequestedSampleCount = Number.isFinite(requestedSampleCount)
    ? Math.floor(requestedSampleCount)
    : itemCount;
  const sampleCount = Math.max(
    1,
    Math.min(safeRequestedSampleCount, itemCount),
  );
  if (sampleCount === 1) {
    return [0];
  }

  return Array.from({ length: sampleCount }, (_, sampleIndex) =>
    Math.round(
      (sampleIndex * (itemCount - 1)) / (sampleCount - 1),
    ));
};
