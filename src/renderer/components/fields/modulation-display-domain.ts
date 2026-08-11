export type ModulationDisplayDomain =
  | Readonly<{
      kind: 'bounded';
      min: number;
      max: number;
    }>
  | Readonly<{
      kind: 'circular';
      min: number;
      max: number;
    }>
  | Readonly<{
      kind: 'open';
      softSpan: number;
    }>;

interface ModulationDisplayDomainOptions {
  min?: number | string;
  max?: number | string;
  step?: number | string;
  circular?: boolean;
}

const readFiniteNumber = (value: number | string | undefined): number | null => {
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const resolveModulationDisplayDomain = (
  options: ModulationDisplayDomainOptions,
): ModulationDisplayDomain => {
  const min = readFiniteNumber(options.min);
  const max = readFiniteNumber(options.max);
  if (min !== null && max !== null && max > min) {
    return {
      kind: options.circular ? 'circular' : 'bounded',
      min,
      max,
    };
  }

  const step = readFiniteNumber(options.step);
  return {
    kind: 'open',
    softSpan: Math.max(step !== null && step > 0 ? step * 100 : 1, 0.000001),
  };
};

export const resolveModulationAmountRatio = (
  amount: number,
  domain: ModulationDisplayDomain,
): number => {
  const scale = domain.kind === 'open'
    ? domain.softSpan
    : domain.max - domain.min;
  return Math.min(Math.abs(amount) / Math.max(scale, 0.000001), 1);
};

export const resolveLinearModulationRangeFillRatio = (
  baseValue: number,
  amount: number,
  domain: ModulationDisplayDomain,
): number => {
  if (domain.kind === 'circular') {
    return 0;
  }

  const magnitude = Math.abs(amount);
  const toPercent = domain.kind === 'bounded'
    ? (value: number): number => (
        (value - domain.min) / Math.max(domain.max - domain.min, 0.000001)
      )
    : (value: number): number => (
        0.5 + (value - baseValue) / Math.max(domain.softSpan * 2, 0.000001)
      );
  const start = Math.max(0, Math.min(toPercent(baseValue - magnitude), 1));
  const end = Math.max(0, Math.min(toPercent(baseValue + magnitude), 1));
  return Math.max(0, Math.min(Math.abs(end - start), 1));
};
