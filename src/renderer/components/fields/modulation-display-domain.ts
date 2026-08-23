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

export const resolveLinearModulationDisplaySpan = (
  domain: ModulationDisplayDomain,
): number => domain.kind === 'open'
  ? domain.softSpan * 2
  : Math.max(domain.max - domain.min, 0.000001);

export const resolveLinearModulationRangeFillRatio = (
  amount: number,
  domain: ModulationDisplayDomain,
): number => {
  return Math.min(
    Math.abs(amount) * 2 / resolveLinearModulationDisplaySpan(domain),
    1,
  );
};
