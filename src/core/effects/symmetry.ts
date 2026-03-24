import type { Bounds, ClipShape, SceneInstance } from '../core-types';
import type { SymmetryEffectNode } from '../../shared/model';
import {
  COMPOSITION_CENTER,
  createHalfPlaneClip,
  createTileUnionClip,
  composeAffine,
  intersectClipShapes,
  toAxisMirrorTransformAt,
  toRotateTransformAt,
} from '../geometry';
import {
  appendClipToSceneInstance,
  applySpatialTransformToSceneInstance,
} from '../layer-utils';

interface QuadrantDescriptor {
  id: SymmetryEffectNode['params']['sourceAnchor'];
  xMin: boolean;
  yMin: boolean;
}

const SYMMETRY_QUADRANTS: ReadonlyArray<QuadrantDescriptor> = Object.freeze([
  { id: 'bl', xMin: true, yMin: true },
  { id: 'br', xMin: false, yMin: true },
  { id: 'tr', xMin: false, yMin: false },
  { id: 'tl', xMin: true, yMin: false },
]);

const COMPOSITION_CLIP = createTileUnionClip(
  Array.from({ length: 100 }, (_, tileId) => tileId),
);
const STRICT_HALF_PLANE_EPSILON = 1e-9;

const isAnchorMinX = (anchor: SymmetryEffectNode['params']['sourceAnchor']): boolean =>
  anchor === 'bl' || anchor === 'tl';

const isAnchorMinY = (anchor: SymmetryEffectNode['params']['sourceAnchor']): boolean =>
  anchor === 'bl' || anchor === 'br';

const createBoundaryHalfPlane = (
  axis: 'x' | 'y',
  boundary: number,
  side: 'min' | 'max',
): ClipShape => {
  if (axis === 'x') {
    return createHalfPlaneClip(
      { x: side === 'max' ? boundary + STRICT_HALF_PLANE_EPSILON : boundary, y: 0 },
      { x: side === 'min' ? -1 : 1, y: 0 },
    );
  }

  return createHalfPlaneClip(
    { x: 0, y: side === 'max' ? boundary + STRICT_HALF_PLANE_EPSILON : boundary },
    { x: 0, y: side === 'min' ? -1 : 1 },
  );
};

const createQuadrantClip = (
  quadrant: QuadrantDescriptor,
): ClipShape => intersectClipShapes([
  COMPOSITION_CLIP,
  createBoundaryHalfPlane('x', COMPOSITION_CENTER.x, quadrant.xMin ? 'min' : 'max'),
  createBoundaryHalfPlane('y', COMPOSITION_CENTER.y, quadrant.yMin ? 'min' : 'max'),
]);

const createMirrorHalfClip = (
  effect: SymmetryEffectNode,
  target: 'source' | 'target',
): ClipShape => {
  const sourceOnMin = effect.params.axis === 'horizontal'
    ? isAnchorMinX(effect.params.sourceAnchor)
    : isAnchorMinY(effect.params.sourceAnchor);
  const keepMin = target === 'source' ? sourceOnMin : !sourceOnMin;
  const axis = effect.params.axis === 'horizontal' ? 'x' : 'y';

  return intersectClipShapes([
    COMPOSITION_CLIP,
    createBoundaryHalfPlane(axis, axis === 'x' ? COMPOSITION_CENTER.x : COMPOSITION_CENTER.y, keepMin ? 'min' : 'max'),
  ]);
};

const withSymmetryMirrorHalf = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  effect: SymmetryEffectNode,
  worldBounds: Bounds,
): SceneInstance[] => {
  const next: SceneInstance[] = [];

  for (const sceneInstance of sceneInstances) {
    next.push(appendClipToSceneInstance(sceneInstance, createMirrorHalfClip(effect, 'source')));

    const mirrored = applySpatialTransformToSceneInstance(
      sceneInstance,
      toAxisMirrorTransformAt(effect.params.axis, COMPOSITION_CENTER),
      worldBounds,
    );
    if (!mirrored) {
      continue;
    }

    next.push(appendClipToSceneInstance(mirrored, createMirrorHalfClip(effect, 'target')));
  }

  return next;
};

const withSymmetryQuadMirror = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  effect: SymmetryEffectNode,
  worldBounds: Bounds,
): SceneInstance[] => {
  const next: SceneInstance[] = [];
  const sourceQuadrant = SYMMETRY_QUADRANTS.find((quadrant) => quadrant.id === effect.params.sourceAnchor)!;

  for (const sceneInstance of sceneInstances) {
    for (const targetQuadrant of SYMMETRY_QUADRANTS) {
      const quadrantClip = createQuadrantClip(targetQuadrant);

      if (targetQuadrant.id === sourceQuadrant.id) {
        next.push(appendClipToSceneInstance(sceneInstance, quadrantClip));
        continue;
      }

      let transform = null as ReturnType<typeof toRotateTransformAt> | null;
      if (sourceQuadrant.xMin !== targetQuadrant.xMin) {
        transform = toAxisMirrorTransformAt('horizontal', COMPOSITION_CENTER);
      }
      if (sourceQuadrant.yMin !== targetQuadrant.yMin) {
        const vertical = toAxisMirrorTransformAt('vertical', COMPOSITION_CENTER);
        transform = transform ? composeAffine(vertical, transform) : vertical;
      }
      if (!transform) {
        next.push(appendClipToSceneInstance(sceneInstance, quadrantClip));
        continue;
      }

      const mirrored = applySpatialTransformToSceneInstance(sceneInstance, transform, worldBounds);
      if (!mirrored) {
        continue;
      }
      next.push(appendClipToSceneInstance(mirrored, quadrantClip));
    }
  }

  return next;
};

const withSymmetryQuadPinwheel = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  effect: SymmetryEffectNode,
  worldBounds: Bounds,
): SceneInstance[] => {
  const next: SceneInstance[] = [];
  const sourceIndex = SYMMETRY_QUADRANTS.findIndex((quadrant) => quadrant.id === effect.params.sourceAnchor);

  for (const sceneInstance of sceneInstances) {
    for (let targetIndex = 0; targetIndex < SYMMETRY_QUADRANTS.length; targetIndex += 1) {
      const targetQuadrant = SYMMETRY_QUADRANTS[targetIndex];
      const quadrantClip = createQuadrantClip(targetQuadrant);
      const delta = (targetIndex - sourceIndex + SYMMETRY_QUADRANTS.length) % SYMMETRY_QUADRANTS.length;
      const angleDeg = delta * 90;

      if (angleDeg === 0) {
        next.push(appendClipToSceneInstance(sceneInstance, quadrantClip));
        continue;
      }

      const rotated = applySpatialTransformToSceneInstance(
        sceneInstance,
        toRotateTransformAt(angleDeg, COMPOSITION_CENTER),
        worldBounds,
      );
      if (!rotated) {
        continue;
      }
      next.push(appendClipToSceneInstance(rotated, quadrantClip));
    }
  }

  return next;
};

export const applySymmetryEffect = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  effect: SymmetryEffectNode,
  worldBounds: Bounds,
): SceneInstance[] => {
  if (effect.params.mode === 'mirror-half') {
    return withSymmetryMirrorHalf(sceneInstances, effect, worldBounds);
  }
  if (effect.params.mode === 'quad-mirror') {
    return withSymmetryQuadMirror(sceneInstances, effect, worldBounds);
  }
  return withSymmetryQuadPinwheel(sceneInstances, effect, worldBounds);
};
