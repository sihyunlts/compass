const BEAT_MATCH_EPSILON = 0.000001;

export const DEFAULT_AUTO_CREATE_LENGTH_BEATS = 1;

export const AUTO_CREATE_LENGTH_OPTIONS = [
  { label: '4/1', beats: 16 },
  { label: '2/1', beats: 8 },
  { label: '1/1', beats: 4 },
  { label: '1/2', beats: 2 },
  { label: '1/4', beats: 1 },
  { label: '1/8', beats: 0.5 },
  { label: '1/16', beats: 0.25 },
] as const;

const isSameBeats = (left: number, right: number): boolean =>
  Math.abs(left - right) < BEAT_MATCH_EPSILON;

export const parseBeatsValue = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric;
    }

    const fractionMatch = trimmed.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (fractionMatch) {
      const numerator = Number(fractionMatch[1]);
      const denominator = Number(fractionMatch[2]);
      if (denominator > 0) {
        return (numerator / denominator) * 4;
      }
    }
  }

  return Number.NaN;
};

export const sanitizeAutoCreateLengthBeats = (
  value: unknown,
  fallback = DEFAULT_AUTO_CREATE_LENGTH_BEATS,
): number => {
  const numeric = parseBeatsValue(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const matched = AUTO_CREATE_LENGTH_OPTIONS.find((option) =>
    isSameBeats(option.beats, numeric),
  );
  return matched?.beats ?? fallback;
};

export const toLengthPresetLabel = (
  beats: number,
  fallbackLabel = '1/1',
): string => {
  const matched = AUTO_CREATE_LENGTH_OPTIONS.find((option) =>
    isSameBeats(option.beats, beats),
  );
  return matched?.label ?? fallbackLabel;
};
