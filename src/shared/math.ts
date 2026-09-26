export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const toDecimalInteger = (value: number): { integer: bigint; exponent: number } => {
  const [significand, exponentText = '0'] = String(value).split('e');
  const [whole, fraction = ''] = significand.split('.');
  return {
    integer: BigInt(`${whole}${fraction}`),
    exponent: Number(exponentText) - fraction.length,
  };
};

// Add finite decimal values before converting back to the stored Number format.
export const addDecimalStep = (value: number, step: number): number => {
  const current = toDecimalInteger(value);
  const increment = toDecimalInteger(step);
  const exponent = Math.min(current.exponent, increment.exponent);
  const sum = current.integer * 10n ** BigInt(current.exponent - exponent)
    + increment.integer * 10n ** BigInt(increment.exponent - exponent);
  return Number(`${sum}e${exponent}`);
};
