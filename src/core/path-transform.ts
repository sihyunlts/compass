import type { AffineTransform, Vec2 } from './core-types';
import { applyAffine, composeAffine } from './geometry';
import type { PathTransform } from '../shared/model';

export const toPathAffine = (transform: Readonly<PathTransform>): AffineTransform => ({
  a: transform.a * transform.scaleX,
  b: transform.b * transform.scaleY,
  c: transform.c * transform.scaleX,
  d: transform.d * transform.scaleY,
  tx: transform.tx,
  ty: transform.ty,
});

export const composePathTransform = (
  after: AffineTransform,
  before: Readonly<PathTransform>,
): PathTransform => ({
  ...composeAffine(after, before),
  scaleX: before.scaleX,
  scaleY: before.scaleY,
});

export const setPathScalesAt = (
  transform: Readonly<PathTransform>,
  scaleX: number,
  scaleY: number,
  fixedPoint: Vec2,
): PathTransform => {
  const previousPoint = applyAffine(toPathAffine(transform), fixedPoint);
  const next = { ...transform, scaleX, scaleY };
  const nextPoint = applyAffine(toPathAffine(next), fixedPoint);
  return {
    ...next,
    tx: next.tx + previousPoint.x - nextPoint.x,
    ty: next.ty + previousPoint.y - nextPoint.y,
  };
};
