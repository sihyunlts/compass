import { clamp } from '../shared/math';
import type { CurveNode } from '../shared/model';

export interface CurvePoint {
  t: number;
  v: number;
}

export interface CurveSegment {
  start: CurvePoint;
  controlOut: CurvePoint;
  controlIn: CurvePoint;
  end: CurvePoint;
}

export const roundCurveNumber = (value: number): number => Number(value.toFixed(6));

const mix = (a: CurvePoint, b: CurvePoint, u: number): CurvePoint => ({
  t: a.t + (b.t - a.t) * u,
  v: a.v + (b.v - a.v) * u,
});

const curveCoordinateAt = (a: number, b: number, c: number, d: number, u: number): number => {
  const r = 1 - u;
  return r * r * r * a + 3 * r * r * u * b + 3 * r * u * u * c + u * u * u * d;
};

export const curvePointAt = (segment: CurveSegment, u: number): CurvePoint => {
  const { start: a, controlOut: b, controlIn: c, end: d } = segment;
  return {
    t: curveCoordinateAt(a.t, b.t, c.t, d.t, u),
    v: curveCoordinateAt(a.v, b.v, c.v, d.v, u),
  };
};

// Both time handles stay inside their segment. Even crossing control points
// therefore describe a single-valued time graph (CSS cubic-bezier semantics).
export const buildCurveSegments = (nodes: ReadonlyArray<CurveNode>): CurveSegment[] =>
  nodes.slice(0, -1).map((start, index) => {
    const end = nodes[index + 1];
    return {
      start: { t: start.t, v: start.v },
      end: { t: end.t, v: end.v },
      controlOut: start.handleOut ? {
        t: clamp(start.t + start.handleOut.t, start.t, end.t),
        v: start.v + start.handleOut.v,
      } : { t: start.t, v: start.v },
      controlIn: end.handleIn ? {
        t: clamp(end.t + end.handleIn.t, start.t, end.t),
        v: end.v + end.handleIn.v,
      } : { t: end.t, v: end.v },
    };
  });

const solveCoordinate = (segment: CurveSegment, axis: 't' | 'v', value: number): number => {
  const { start: a, controlOut: b, controlIn: c, end: d } = segment;
  const increasing = d[axis] >= a[axis];
  if (increasing ? value <= a[axis] : value >= a[axis]) return 0;
  if (increasing ? value >= d[axis] : value <= d[axis]) return 1;
  let low = 0;
  let high = 1;
  let u = clamp((value - a[axis]) / (d[axis] - a[axis]), 0, 1);
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const result = curveCoordinateAt(a[axis], b[axis], c[axis], d[axis], u);
    if (Math.abs(result - value) <= 1e-14) return u;
    if ((result < value) === increasing) low = u;
    else high = u;
    u = (low + high) / 2;
  }
  return u;
};

export const isLinearCurveSegment = ({ start, controlOut, controlIn, end }: CurveSegment): boolean => {
  const span = end.t - start.t;
  const valueSpan = end.v - start.v;
  const tolerance = 1e-12 * Math.abs(span);
  return Math.abs((controlOut.v - start.v) * span - (controlOut.t - start.t) * valueSpan) <= tolerance
    && Math.abs((controlIn.v - start.v) * span - (controlIn.t - start.t) * valueSpan) <= tolerance;
};

export const evaluateCurveSegments = (segments: ReadonlyArray<CurveSegment>, t01: number): number => {
  if (!segments.length) return 0;
  const t = clamp(Number.isFinite(t01) ? t01 : 0, 0, 1);
  if (t <= segments[0].start.t) return segments[0].start.v;
  const last = segments[segments.length - 1];
  if (t >= last.end.t) return last.end.v;
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (t <= segments[middle].end.t) high = middle;
    else low = middle + 1;
  }
  const segment = segments[low];
  if (isLinearCurveSegment(segment)) {
    return segment.start.v + (segment.end.v - segment.start.v)
      * ((t - segment.start.t) / (segment.end.t - segment.start.t));
  }
  return curvePointAt(segment, solveCoordinate(segment, 't', t)).v;
};

// Call with a value-monotone segment, as produced by splitCurveAtValueExtrema.
export const invertCurveSegment = (segment: CurveSegment, value: number): number => {
  if (isLinearCurveSegment(segment)) {
    return segment.start.t + (segment.end.t - segment.start.t)
      * clamp((value - segment.start.v) / (segment.end.v - segment.start.v), 0, 1);
  }
  return curvePointAt(segment, solveCoordinate(segment, 'v', value)).t;
};

const quadraticRoots = (a: number, b: number, c: number): number[] => {
  if (Math.abs(a) < 1e-14) return Math.abs(b) < 1e-14 ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  const q = -0.5 * (b + (b >= 0 ? root : -root));
  return q === 0 ? [-b / (2 * a)] : [q / a, c / q];
};

// Derivative coefficients, with the common factor 3 omitted.
const derivative = (a: number, b: number, c: number, d: number): [number, number, number] =>
  [-a + 3 * b - 3 * c + d, 2 * (a - 2 * b + c), b - a];

const splitCurveSegment = (segment: CurveSegment, u: number): [CurveSegment, CurveSegment] => {
  const a = mix(segment.start, segment.controlOut, u);
  const b = mix(segment.controlOut, segment.controlIn, u);
  const c = mix(segment.controlIn, segment.end, u);
  const d = mix(a, b, u);
  const e = mix(b, c, u);
  const point = mix(d, e, u);
  return [
    { start: segment.start, controlOut: a, controlIn: d, end: point },
    { start: point, controlOut: e, controlIn: c, end: segment.end },
  ];
};

export const splitCurveAtValueExtrema = (segment: CurveSegment): CurveSegment[] => {
  const { start, controlOut, controlIn, end } = segment;
  const roots = quadraticRoots(...derivative(start.v, controlOut.v, controlIn.v, end.v))
    .filter((u) => u > 1e-12 && u < 1 - 1e-12)
    .sort((a, b) => a - b);
  const segments: CurveSegment[] = [];
  let remainder = segment;
  let previous = 0;
  for (const root of roots) {
    if (root - previous <= 1e-12) continue;
    const [left, right] = splitCurveSegment(remainder, (root - previous) / (1 - previous));
    segments.push(left);
    remainder = right;
    previous = root;
  }
  return [...segments, remainder];
};

export const resolveCurveSegmentMaxRate = (segment: CurveSegment): number => {
  const { start, controlOut, controlIn, end } = segment;
  if (isLinearCurveSegment(segment)) return Math.abs((end.v - start.v) / (end.t - start.t));
  const [a, b, c] = derivative(start.t, controlOut.t, controlIn.t, end.t);
  const [d, e, f] = derivative(start.v, controlOut.v, controlIn.v, end.v);
  const candidates = [0, 1,
    ...quadraticRoots(d * b - a * e, 2 * (d * c - a * f), e * c - b * f),
    ...quadraticRoots(a, b, c),
  ].filter((u) => u >= 0 && u <= 1);
  return Math.max(...candidates.map((u) => {
    let dx = (a * u + b) * u + c;
    let dy = (d * u + e) * u + f;
    if (Math.abs(dx) < 1e-14 && Math.abs(dy) < 1e-14) {
      dx = 2 * a * u + b;
      dy = 2 * d * u + e;
      if (Math.abs(dx) < 1e-14 && Math.abs(dy) < 1e-14) {
        dx = a;
        dy = d;
      }
    }
    return Math.abs(dx) < 1e-14 ? Infinity : Math.abs(dy / dx);
  }));
};
