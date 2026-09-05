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
