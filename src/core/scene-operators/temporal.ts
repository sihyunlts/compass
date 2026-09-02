import type { TemporalSampledRemap } from '../core-types';

const interpolateNullableSample = (
  left: number | null,
  right: number | null,
  ratio: number,
): number | null => {
  if (left === null) {
    return ratio <= 0 ? left : null;
  }
  if (right === null) {
    return ratio >= 1 ? right : null;
  }

  return left + (right - left) * ratio;
};

export const evaluateTemporalRemap = (
  remap: TemporalSampledRemap,
  t01: number,
): number | null => {
  if (!Number.isFinite(t01)) {
    return null;
  }

  const sampleCount = remap.samples.length;
  if (sampleCount === 0) {
    return null;
  }
  if (sampleCount === 1) {
    return remap.samples[0];
  }

  const domainSpan = remap.domainEnd - remap.domainStart;
  if (!Number.isFinite(domainSpan) || domainSpan <= 0) {
    return null;
  }

  const clampedT = Math.min(Math.max(t01, remap.domainStart), remap.domainEnd);
  const normalizedT = (clampedT - remap.domainStart) / domainSpan;
  const scaledIndex = normalizedT * (sampleCount - 1);
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.min(sampleCount - 1, Math.ceil(scaledIndex));
  const ratio = scaledIndex - lowerIndex;
  const lowerSample = remap.samples[lowerIndex] ?? null;
  const upperSample = remap.samples[upperIndex] ?? null;

  return interpolateNullableSample(lowerSample, upperSample, ratio);
};

export const isNonWrapping01TemporalWindow = (
  start: number,
  end: number,
): boolean => (
  Number.isFinite(start)
  && Number.isFinite(end)
  && start >= 0
  && end <= 1
  && end > start
);
