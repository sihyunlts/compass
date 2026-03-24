import type {
  AffineTransform,
  Bounds,
  ClipShape,
  HalfPlaneClipShape,
  Polyline,
  SceneClip,
  TileUnionClipShape,
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

const TILE_MIN = 0;
const TILE_MAX = 9;
const TILE_COUNT = 10;

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

const isInTileBounds = (value: number): boolean =>
  Number.isFinite(value) && value >= TILE_MIN && value <= TILE_MAX;

const toTileIndex = (point: Vec2): number | null => {
  if (!isInTileBounds(point.x) || !isInTileBounds(point.y)) {
    return null;
  }

  const tileX = Math.round(point.x);
  const tileY = Math.round(point.y);
  if (!isInTileBounds(tileX) || !isInTileBounds(tileY)) {
    return null;
  }

  return tileY * TILE_COUNT + tileX;
};

export const mapBoundsThroughAffine = (bounds: Bounds, transform: AffineTransform): Bounds => {
  const corners = [
    applyAffine(transform, { x: bounds.minX, y: bounds.minY }),
    applyAffine(transform, { x: bounds.minX, y: bounds.maxY }),
    applyAffine(transform, { x: bounds.maxX, y: bounds.minY }),
    applyAffine(transform, { x: bounds.maxX, y: bounds.maxY }),
  ];

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    if (corner.x < minX) minX = corner.x;
    if (corner.x > maxX) maxX = corner.x;
    if (corner.y < minY) minY = corner.y;
    if (corner.y > maxY) maxY = corner.y;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return { ...bounds };
  }

  return { minX, maxX, minY, maxY };
};

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

export const createTileUnionClip = (
  tiles: Iterable<number>,
): TileUnionClipShape => ({
  kind: 'tile-union',
  tiles: Array.from(new Set(tiles)).sort((left, right) => left - right),
});

export const createHalfPlaneClip = (
  point: Vec2,
  normal: Vec2,
): HalfPlaneClipShape => ({
  kind: 'half-plane',
  point: { ...point },
  normal: { ...normal },
});

export const intersectClipShapes = (
  shapes: ReadonlyArray<ClipShape>,
): ClipShape => {
  const flattened: ClipShape[] = [];
  for (const shape of shapes) {
    if (shape.kind === 'intersection') {
      flattened.push(...shape.shapes);
      continue;
    }
    flattened.push(shape);
  }

  if (flattened.length === 1) {
    return flattened[0];
  }

  return {
    kind: 'intersection',
    shapes: flattened,
  };
};

export const evaluateClipShape = (
  shape: ClipShape,
  point: Vec2,
): boolean => {
  if (shape.kind === 'tile-union') {
    const tileIndex = toTileIndex(point);
    return tileIndex !== null && shape.tiles.includes(tileIndex);
  }

  if (shape.kind === 'half-plane') {
    const dx = point.x - shape.point.x;
    const dy = point.y - shape.point.y;
    return (dx * shape.normal.x) + (dy * shape.normal.y) >= 0;
  }

  return shape.shapes.every((child) => evaluateClipShape(child, point));
};

export const isPointInsideClip = (
  clip: SceneClip,
  point: Vec2,
): boolean => evaluateClipShape(clip.shape, applyAffine(clip.inverseTransform, point));

export const isPointInsideClipStack = (
  clipStack: ReadonlyArray<SceneClip>,
  point: Vec2,
): boolean => clipStack.every((clip) => isPointInsideClip(clip, point));

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
