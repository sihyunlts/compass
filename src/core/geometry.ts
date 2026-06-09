import type {
  AffineTransform,
  Bounds,
  Polyline,
  Vec2,
} from './core-types';

export const COMPOSITION_BOUNDS: Bounds = Object.freeze({
  minX: 0,
  maxX: 9,
  minY: 0,
  maxY: 9,
});

export const COMPOSITION_CENTER = Object.freeze({ x: 4.5, y: 4.5 });

export const IDENTITY_AFFINE: AffineTransform = Object.freeze({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
});

export const composeAffine = (after: AffineTransform, before: AffineTransform): AffineTransform => ({
  a: after.a * before.a + after.b * before.c,
  b: after.a * before.b + after.b * before.d,
  c: after.c * before.a + after.d * before.c,
  d: after.c * before.b + after.d * before.d,
  tx: after.a * before.tx + after.b * before.ty + after.tx,
  ty: after.c * before.tx + after.d * before.ty + after.ty,
});

export const invertAffine = (transform: AffineTransform): AffineTransform | null => {
  const det = transform.a * transform.d - transform.b * transform.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    return null;
  }

  const invA = transform.d / det;
  const invB = -transform.b / det;
  const invC = -transform.c / det;
  const invD = transform.a / det;
  return {
    a: invA,
    b: invB,
    c: invC,
    d: invD,
    tx: -(invA * transform.tx + invB * transform.ty),
    ty: -(invC * transform.tx + invD * transform.ty),
  };
};

export const applyAffine = (transform: AffineTransform, point: Vec2): Vec2 => ({
  x: transform.a * point.x + transform.b * point.y + transform.tx,
  y: transform.c * point.x + transform.d * point.y + transform.ty,
});

export const toAxisBasis = (angleDeg: number): { axisX: number; axisY: number; perpX: number; perpY: number } => {
  const rad = (angleDeg * Math.PI) / 180;
  const axisX = Math.cos(rad);
  const axisY = Math.sin(rad);
  return {
    axisX,
    axisY,
    perpX: -axisY,
    perpY: axisX,
  };
};

export const toMirrorTransformAt = (angleDeg: number, center: Vec2): AffineTransform => {
  const rad = (angleDeg * Math.PI) / 180;
  const axisX = Math.cos(rad);
  const axisY = Math.sin(rad);
  const a = (2 * axisX * axisX) - 1;
  const b = 2 * axisX * axisY;
  const c = b;
  const d = (2 * axisY * axisY) - 1;
  return {
    a,
    b,
    c,
    d,
    tx: center.x - ((a * center.x) + (b * center.y)),
    ty: center.y - ((c * center.x) + (d * center.y)),
  };
};

export const toAxisMirrorTransformAt = (
  axis: 'horizontal' | 'vertical',
  center: Vec2,
): AffineTransform => {
  if (axis === 'horizontal') {
    return {
      a: -1,
      b: 0,
      c: 0,
      d: 1,
      tx: 2 * center.x,
      ty: 0,
    };
  }

  return {
    a: 1,
    b: 0,
    c: 0,
    d: -1,
    tx: 0,
    ty: 2 * center.y,
  };
};

export const toRotateTransformAt = (angleDeg: number, center: Vec2): AffineTransform => {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    a: cos,
    b: -sin,
    c: sin,
    d: cos,
    tx: center.x - center.x * cos + center.y * sin,
    ty: center.y - center.x * sin - center.y * cos,
  };
};

export const toTranslationTransform = (
  offsetX: number,
  offsetY: number,
): AffineTransform => ({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: offsetX,
  ty: offsetY,
});

export const toScaleTransformAt = (
  scaleX: number,
  scaleY: number,
  center: Vec2,
): AffineTransform | null => {
  if (!Number.isFinite(center.x)
    || !Number.isFinite(center.y)
    || !Number.isFinite(scaleX)
    || !Number.isFinite(scaleY)
    || scaleX <= 0
    || scaleY <= 0) {
    return null;
  }

  return {
    a: scaleX,
    b: 0,
    c: 0,
    d: scaleY,
    tx: center.x - (center.x * scaleX),
    ty: center.y - (center.y * scaleY),
  };
};

const distanceToSegmentSquared = (point: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    const px = point.x - a.x;
    const py = point.y - a.y;
    return px * px + py * py;
  }

  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  const projX = a.x + clamped * dx;
  const projY = a.y + clamped * dy;
  const vx = point.x - projX;
  const vy = point.y - projY;
  return vx * vx + vy * vy;
};

export const distanceToPolylineSquared = (point: Vec2, polyline: Polyline): number => {
  const pts = polyline.points;
  if (pts.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (pts.length === 1) {
    const dx = point.x - pts[0].x;
    const dy = point.y - pts[0].y;
    return dx * dx + dy * dy;
  }

  let minDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const dist = distanceToSegmentSquared(point, pts[i], pts[i + 1]);
    if (dist < minDist) {
      minDist = dist;
    }
  }
  if (polyline.closed) {
    const dist = distanceToSegmentSquared(point, pts[pts.length - 1], pts[0]);
    if (dist < minDist) {
      minDist = dist;
    }
  }

  return minDist;
};

export const applyTransformToPolyline = (polyline: Polyline, transform: AffineTransform): Polyline => ({
  ...polyline,
  points: polyline.points.map((pt) => applyAffine(transform, pt)),
});

export const clampBounds = (bounds: Bounds): Bounds => ({
  minX: Math.min(bounds.minX, bounds.maxX),
  maxX: Math.max(bounds.minX, bounds.maxX),
  minY: Math.min(bounds.minY, bounds.maxY),
  maxY: Math.max(bounds.minY, bounds.maxY),
});
