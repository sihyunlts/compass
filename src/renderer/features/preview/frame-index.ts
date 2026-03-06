import { clamp } from '../../../shared/math';

const PREVIEW_FRAME_BUCKETS = 512;
export const PREVIEW_FRAME_COUNT = PREVIEW_FRAME_BUCKETS + 1;

const resolveSpan = (span: number): number => (
  Number.isFinite(span) && span > 0 ? span : 1
);

export const toPreviewFrameIndex = (beat: number, span = 1): number => {
  const safeSpan = resolveSpan(span);
  const normalizedBeat = clamp(
    (Number.isFinite(beat) ? beat : 0) / safeSpan,
    0,
    1,
  );
  if (normalizedBeat >= 1) {
    return PREVIEW_FRAME_BUCKETS;
  }
  return Math.floor(normalizedBeat * PREVIEW_FRAME_BUCKETS);
};

export const toPreviewFrameBeat = (index: number, span = 1): number => {
  const safeSpan = resolveSpan(span);
  const normalizedIndex = clamp(
    Number.isFinite(index) ? Math.round(index) : 0,
    0,
    PREVIEW_FRAME_BUCKETS,
  );
  return (normalizedIndex / PREVIEW_FRAME_BUCKETS) * safeSpan;
};
