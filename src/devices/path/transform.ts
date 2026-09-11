import { resolvePathBounds } from '../../core/generators/path';
import {
  applyAffine,
  toRotateTransformAt,
  toTranslationTransform,
} from '../../core/geometry';
import { composePathTransform, setPathScalesAt, toPathAffine } from '../../core/path-transform';
import type { PathAnchor, PathTransform } from '../../shared/model';

export type PathTransformParameter = 'x' | 'y' | 'rotation' | 'width' | 'height';

export interface PathTransformMetrics {
  center: { x: number; y: number };
  localCenter: { x: number; y: number };
  width: number;
  height: number;
  basisWidth: number;
  basisHeight: number;
  rotation: number;
}

const normalizeRotationDegrees = (degrees: number): number => (
  ((degrees + 180) % 360 + 360) % 360 - 180
);

export const resolvePathTransformMetrics = (
  anchors: readonly PathAnchor[],
  closed: boolean,
  transform: PathTransform,
): PathTransformMetrics | null => {
  const bounds = resolvePathBounds(anchors, closed);
  if (!bounds) {
    return null;
  }
  const localCenter = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  const basisWidth = (bounds.maxX - bounds.minX) * Math.hypot(transform.a, transform.c);
  const basisHeight = (bounds.maxY - bounds.minY) * Math.hypot(transform.b, transform.d);
  return {
    center: applyAffine(toPathAffine(transform), localCenter),
    localCenter,
    width: basisWidth * transform.scaleX,
    height: basisHeight * transform.scaleY,
    basisWidth,
    basisHeight,
    rotation: normalizeRotationDegrees(Math.atan2(transform.c, transform.a) * 180 / Math.PI),
  };
};

export const setPathTransformParameter = (
  transform: PathTransform,
  metrics: PathTransformMetrics,
  parameter: PathTransformParameter,
  value: number,
): PathTransform => {
  if (parameter === 'width' || parameter === 'height') {
    const basisSize = parameter === 'width' ? metrics.basisWidth : metrics.basisHeight;
    if (basisSize === 0) {
      return transform;
    }
    return setPathScalesAt(
      transform,
      parameter === 'width' ? value / basisSize : transform.scaleX,
      parameter === 'height' ? value / basisSize : transform.scaleY,
      metrics.localCenter,
    );
  }
  const transformChange = parameter === 'rotation'
    ? toRotateTransformAt(value - metrics.rotation, metrics.center)
    : parameter === 'x'
      ? toTranslationTransform(value - metrics.center.x, 0)
      : toTranslationTransform(0, value - metrics.center.y);
  return composePathTransform(transformChange, transform);
};
