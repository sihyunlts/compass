import { clamp } from '../../shared/math';

const PREVIEW_FRAME_BUCKETS = 512;
export const PREVIEW_FRAME_COUNT = PREVIEW_FRAME_BUCKETS + 1;

export const toPreviewFrameIndex = (beat01: number): number => {
  const normalizedBeat = clamp(Number.isFinite(beat01) ? beat01 : 0, 0, 1);
  if (normalizedBeat >= 1) {
    return PREVIEW_FRAME_BUCKETS;
  }
  return Math.floor(normalizedBeat * PREVIEW_FRAME_BUCKETS);
};

export const toPreviewFrameBeat = (index: number): number => {
  const normalizedIndex = clamp(
    Number.isFinite(index) ? Math.round(index) : 0,
    0,
    PREVIEW_FRAME_BUCKETS,
  );
  return normalizedIndex / PREVIEW_FRAME_BUCKETS;
};
