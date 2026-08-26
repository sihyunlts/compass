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

const AFFINE_INVERSE_RELATIVE_EPSILON = 1e-12;

interface LinearTransform {
  a: number;
  b: number;
  c: number;
  d: number;
}

export const affineLinearDeterminant = (
  transform: LinearTransform,
): number => transform.a * transform.d - transform.b * transform.c;

const resolveMaxLinearComponent = (
  transform: LinearTransform,
): number | null => {
  const maxComponent = Math.max(
    Math.abs(transform.a),
    Math.abs(transform.b),
    Math.abs(transform.c),
    Math.abs(transform.d),
  );
  return Number.isFinite(maxComponent) ? maxComponent : null;
};

const isFiniteLinearTransform = (
  transform: LinearTransform,
): boolean => Number.isFinite(transform.a)
  && Number.isFinite(transform.b)
  && Number.isFinite(transform.c)
  && Number.isFinite(transform.d);

const invertLinear = (
  transform: LinearTransform,
): LinearTransform | null => {
  const scale = resolveMaxLinearComponent(transform);
  if (scale === null || scale === 0) {
    return null;
  }

  const normalized = {
    a: transform.a / scale,
    b: transform.b / scale,
    c: transform.c / scale,
    d: transform.d / scale,
  };
  const normalizedDeterminant = affineLinearDeterminant(normalized);
  if (Math.abs(normalizedDeterminant) < AFFINE_INVERSE_RELATIVE_EPSILON) {
    return null;
  }

  const denominator = normalizedDeterminant * scale;
  const inverse = {
    a: normalized.d / denominator,
    b: -normalized.b / denominator,
    c: -normalized.c / denominator,
    d: normalized.a / denominator,
  };
  return isFiniteLinearTransform(inverse) ? inverse : null;
};

export const invertAffine = (transform: AffineTransform): AffineTransform | null => {
  const inverse = invertLinear(transform);
  if (!inverse) {
    return null;
  }

  const tx = -(inverse.a * transform.tx + inverse.b * transform.ty);
  const ty = -(inverse.c * transform.tx + inverse.d * transform.ty);
  return Number.isFinite(tx) && Number.isFinite(ty)
    ? { ...inverse, tx, ty }
    : null;
};

const pseudoInvertLinear = (
  transform: LinearTransform,
): LinearTransform | null => {
  const inverse = invertLinear(transform);
  if (inverse) {
    return inverse;
  }

  const scale = resolveMaxLinearComponent(transform);
  if (scale === null) {
    return null;
  }
  if (scale === 0) {
    return { a: 0, b: 0, c: 0, d: 0 };
  }

  const normalized = {
    a: transform.a / scale,
    b: transform.b / scale,
    c: transform.c / scale,
    d: transform.d / scale,
  };
  const normalizedMagnitudeSquared = normalized.a * normalized.a
    + normalized.b * normalized.b
    + normalized.c * normalized.c
    + normalized.d * normalized.d;
  const denominator = scale * normalizedMagnitudeSquared;
  const pseudoInverse = {
    a: normalized.a / denominator,
    b: normalized.c / denominator,
    c: normalized.b / denominator,
    d: normalized.d / denominator,
  };
  return isFiniteLinearTransform(pseudoInverse) ? pseudoInverse : null;
};

export const resolveFixedPointAffinePullback = (
  transform: AffineTransform,
): AffineTransform | null => {
  const inverse = invertAffine(transform);
  if (inverse) {
    return inverse;
  }

  // Deferred masks need one stable source-space sample even when a transform
  // collapses an axis. Use the closest fixed point as the canonical preimage
  // so singular and invertible spatial transforms keep the same vector path.
  const linearPullback = pseudoInvertLinear(transform);
  const fixedPointResolver = pseudoInvertLinear({
    a: 1 - transform.a,
    b: -transform.b,
    c: -transform.c,
    d: 1 - transform.d,
  });
  if (!linearPullback || !fixedPointResolver) {
    return null;
  }

  const fixedX = fixedPointResolver.a * transform.tx
    + fixedPointResolver.b * transform.ty;
  const fixedY = fixedPointResolver.c * transform.tx
    + fixedPointResolver.d * transform.ty;
  const tx = fixedX - linearPullback.a * fixedX - linearPullback.b * fixedY;
  const ty = fixedY - linearPullback.c * fixedX - linearPullback.d * fixedY;
  return Number.isFinite(tx) && Number.isFinite(ty)
    ? { ...linearPullback, tx, ty }
    : null;
};

export const applyAffine = (transform: AffineTransform, point: Vec2): Vec2 => ({
  x: transform.a * point.x + transform.b * point.y + transform.tx,
  y: transform.c * point.x + transform.d * point.y + transform.ty,
});

const TRIGONOMETRIC_SNAP_EPSILON = 1e-12;

const snapTrigonometricValue = (value: number): number => {
  const nearestInteger = Math.round(value);
  return Math.abs(value - nearestInteger) <= TRIGONOMETRIC_SNAP_EPSILON
    ? nearestInteger
    : value;
};

const toAngleComponents = (angleDeg: number): { cos: number; sin: number } => {
  const rad = ((angleDeg % 360) * Math.PI) / 180;
  return {
    cos: snapTrigonometricValue(Math.cos(rad)),
    sin: snapTrigonometricValue(Math.sin(rad)),
  };
};

export const toAxisBasis = (angleDeg: number): { axisX: number; axisY: number; perpX: number; perpY: number } => {
  const { cos: axisX, sin: axisY } = toAngleComponents(angleDeg);
  return {
    axisX,
    axisY,
    perpX: -axisY,
    perpY: axisX,
  };
};

export const toMirrorTransformAt = (angleDeg: number, center: Vec2): AffineTransform => {
  const { cos: axisX, sin: axisY } = toAngleComponents(angleDeg);
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

export const toRotateTransformAt = (angleDeg: number, center: Vec2): AffineTransform => {
  const { cos, sin } = toAngleComponents(angleDeg);
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
    || !Number.isFinite(scaleY)) {
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

const isPointInsideNonZeroFill = (
  point: Readonly<Vec2>,
  polyline: Polyline,
): boolean => {
  const points = polyline.points;
  if (!polyline.closed || points.length < 3) {
    return false;
  }

  let windingNumber = 0;
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const cross = (end.x - start.x) * (point.y - start.y)
      - (point.x - start.x) * (end.y - start.y);
    if (start.y <= point.y) {
      if (end.y > point.y && cross > 0) {
        windingNumber += 1;
      }
    } else if (end.y <= point.y && cross < 0) {
      windingNumber -= 1;
    }
  }
  return windingNumber !== 0;
};

export const distanceToRasterizedPolylineSquared = (
  point: Vec2,
  polyline: Polyline,
): number => polyline.rasterMode === 'fill' && isPointInsideNonZeroFill(point, polyline)
  ? 0
  : distanceToPolylineSquared(point, polyline);

export const applyTransformToPolyline = (polyline: Polyline, transform: AffineTransform): Polyline => ({
  ...polyline,
  points: polyline.points.map((pt) => applyAffine(transform, pt)),
  ...(polyline.rasterTieBreakDirection
    ? {
        rasterTieBreakDirection: {
          x: transform.a * polyline.rasterTieBreakDirection.x
            + transform.b * polyline.rasterTieBreakDirection.y,
          y: transform.c * polyline.rasterTieBreakDirection.x
            + transform.d * polyline.rasterTieBreakDirection.y,
        },
      }
    : {}),
});

export const clampBounds = (bounds: Bounds): Bounds => ({
  minX: Math.min(bounds.minX, bounds.maxX),
  maxX: Math.max(bounds.minX, bounds.maxX),
  minY: Math.min(bounds.minY, bounds.maxY),
  maxY: Math.max(bounds.minY, bounds.maxY),
});
