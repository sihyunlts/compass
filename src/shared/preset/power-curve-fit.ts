import { clamp } from '../math';

interface Point { t: number; v: number }
export interface FittedPowerSegment {
  start: Point;
  controlOut: Point;
  controlIn: Point;
  end: Point;
}
interface Fit {
  segment: FittedPowerSegment;
  error: number;
  splitTime: number;
}

// Prefer editable curves: 0.5% of the original segment value range.
// At 140px graph height this is at most 0.7px, independent of window zoom.
const MAX_NORMALIZED_FIT_ERROR = 0.005;
const FIT_SAMPLES = 32;
const ERROR_SAMPLES = 128;

const cubic = (a: number, b: number, c: number, d: number, u: number): number => {
  const r = 1 - u;
  return r ** 3 * a + 3 * r * r * u * b + 3 * r * u * u * c + u ** 3 * d;
};

/** Fit handle lengths along the original endpoint tangents, including time.
 * Unlike fixed-time Hermite interpolation, both handles can move horizontally.
 * Endpoint values stay intact; endpoint slopes are matched except in effectively
 * flat intervals where subtracting the endpoint values loses precision.
 */
export const fitPowerCurve = (bend: number): FittedPowerSegment[] => {
  const power = 1 + Math.abs(bend) * 23;
  const valueAt = (t: number): number => bend > 0 ? 1 - (1 - t) ** power : t ** power;
  const slopeAt = (t: number): number => power * (bend > 0 ? 1 - t : t) ** (power - 1);
  const fits = new Map<string, Fit>();

  const fitInterval = (a: number, b: number): Fit => {
    const key = `${a}:${b}`;
    const cached = fits.get(key);
    if (cached) return cached;
    const va = valueAt(a);
    const vb = valueAt(b);
    const span = b - a;
    const height = vb - va;
    const slopeStart = height > 1e-12 ? slopeAt(a) * span / height : 1;
    const slopeEnd = height > 1e-12 ? slopeAt(b) * span / height : 1;
    const maxOut = Math.min(1, slopeStart > 0 ? 1 / slopeStart : 1);
    const maxIn = Math.min(1, slopeEnd > 0 ? 1 / slopeEnd : 1);

    const residuals = (out: number, incoming: number) => {
      let loss = 0, aa = 0, ab = 0, bb = 0, ga = 0, gb = 0;
      for (let index = 1; index < FIT_SAMPLES; index += 1) {
        const u = index / FIT_SAMPLES;
        const r = 1 - u;
        const w1 = 3 * r * r * u;
        const w2 = 3 * r * u * u;
        const x = cubic(0, out, 1 - incoming, 1, u);
        const y = cubic(0, out * slopeStart, 1 - incoming * slopeEnd, 1, u);
        const t = a + span * x;
        const residual = y - (valueAt(t) - va) / height;
        const slope = slopeAt(t) * span / height;
        const j1 = w1 * (slopeStart - slope);
        const j2 = w2 * (slope - slopeEnd);
        loss += residual * residual;
        aa += j1 * j1; ab += j1 * j2; bb += j2 * j2;
        ga += j1 * residual; gb += j2 * residual;
      }
      return { loss, aa, ab, bb, ga, gb };
    };

    const measure = (out: number, incoming: number): Fit => {
      const segment: FittedPowerSegment = {
        start: { t: a, v: va }, end: { t: b, v: vb },
        controlOut: { t: a + span * out, v: va + height * out * slopeStart },
        controlIn: { t: b - span * incoming, v: vb - height * incoming * slopeEnd },
      };
      let error = 0;
      let splitTime = (a + b) / 2;
      for (let index = 1; index < ERROR_SAMPLES; index += 1) {
        const u = index / ERROR_SAMPLES;
        const t = cubic(a, segment.controlOut.t, segment.controlIn.t, b, u);
        const v = cubic(va, segment.controlOut.v, segment.controlIn.v, vb, u);
        const difference = Math.abs(v - valueAt(t));
        if (difference > error) { error = difference; splitTime = t; }
      }
      return { segment, error, splitTime };
    };

    let best = measure(Math.min(1 / 3, maxOut), Math.min(1 / 3, maxIn));
    if (best.error > MAX_NORMALIZED_FIT_ERROR) {
      for (const seed of [[1 / 3, 1 / 3], [0.15, 0.15], [0.6, 0.15], [0.15, 0.6], [0.6, 0.6]]) {
        let out = Math.min(seed[0], maxOut);
        let incoming = Math.min(seed[1], maxIn);
        let damping = 1e-8;
        for (let iteration = 0; iteration < 32; iteration += 1) {
          const state = residuals(out, incoming);
          const aa = state.aa + damping;
          const bb = state.bb + damping;
          const determinant = aa * bb - state.ab * state.ab;
          if (determinant <= 0) break;
          const stepOut = (bb * state.ga - state.ab * state.gb) / determinant;
          const stepIn = (aa * state.gb - state.ab * state.ga) / determinant;
          const nextOut = clamp(out - stepOut, 0, maxOut);
          const nextIn = clamp(incoming - stepIn, 0, maxIn);
          if (Math.abs(nextOut - out) + Math.abs(nextIn - incoming) < 1e-12) break;
          if (residuals(nextOut, nextIn).loss < state.loss) {
            out = nextOut; incoming = nextIn; damping = Math.max(damping / 4, 1e-14);
          } else {
            damping *= 10;
          }
        }
        const candidate = measure(out, incoming);
        if (candidate.error < best.error) best = candidate;
        if (best.error <= MAX_NORMALIZED_FIT_ERROR) break;
      }
    }
    fits.set(key, best);
    return best;
  };

  const knots = [0];
  const subdivide = (a: number, b: number): void => {
    const fit = fitInterval(a, b);
    // Both curves stay confined to the same endpoint values.
    // Once the value span is within tolerance, an interval always qualifies.
    if (fit.error <= MAX_NORMALIZED_FIT_ERROR) {
      knots.push(b);
      return;
    }
    const split = clamp(fit.splitTime, a + (b - a) * 0.2, b - (b - a) * 0.2);
    subdivide(a, split);
    subdivide(split, b);
  };
  subdivide(0, 1);

  // Find the fewest fitted segments on the candidate knot set. Every retained
  // edge is fitted again; the binary subdivision's boundaries are not mandatory.
  // This is a discrete minimum, not a claim of globally optimal Bézier fitting.
  const counts = Array<number>(knots.length).fill(Infinity);
  const previous = Array<number>(knots.length).fill(-1);
  counts[0] = 0;
  for (let end = 1; end < knots.length; end += 1) {
    for (let start = 0; start < end; start += 1) {
      if (counts[start] + 1 >= counts[end]) continue;
      if (fitInterval(knots[start], knots[end]).error > MAX_NORMALIZED_FIT_ERROR) continue;
      counts[end] = counts[start] + 1;
      previous[end] = start;
    }
  }
  const merged: FittedPowerSegment[] = [];
  for (let end = knots.length - 1; end > 0;) {
    const start = previous[end];
    merged.push(fitInterval(knots[start], knots[end]).segment);
    end = start;
  }
  return merged.reverse();
};
