import type { Bounds } from '../../../core/core-types';
import {
  applyAffine,
  invertAffine,
  toRotateTransformAt,
  toTranslationTransform,
} from '../../../core/geometry';
import { composePathTransform, setPathScalesAt, toPathAffine } from '../../../core/path-transform';
import {
  PATH_COORDINATE_MIN,
  PATH_COORDINATE_MAX,
  sanitizePathTransform,
} from '../../../devices/path/schema';
import type { PathAnchor, PathTransform } from '../../../shared/model';
import { clamp } from '../../../shared/math';
import { resolveRotationSnap } from './rotation-interaction';
import {
  COORDINATE_RANGE, EDITOR_CENTER, GRID_POSITIONS, SCALE_SNAP_VALUES,
  TRANSFORM_HANDLE_INSET_PERCENT, MIN_PATH_SCALE_SIZE_PX, PATH_TRANSFORM_SNAP_DISTANCE_PX,
  resolveTranslationDelta, resolveTranslatedAxisSnap, resolveTransformAxisSnap,
  resolveSignedMinimumScale, resolveTransformedVectorLengthPx, roundCoordinate, toWorldPoint,
} from './path-editor-geometry';
import type { AlignmentGuides, EditorPoint } from './path-editor-types';

export interface PathTransformUpdate {
  transform: PathTransform;
  alignmentGuides: AlignmentGuides;
  snapSignature: string | null;
}

export const resolvePathMove = (
  rect: DOMRect | undefined,
  startTransform: Readonly<PathTransform>,
  bounds: Bounds,
  startPoint: EditorPoint,
  point: EditorPoint,
  lockAxis: boolean,
  snapEnabled: boolean,
): PathTransformUpdate => {
  const rawDelta = resolveTranslationDelta(startPoint, point, lockAxis);
  const rawDeltaX = rawDelta.x;
  const rawDeltaY = rawDelta.y;
  const translatedCenterX = ((bounds.minX + bounds.maxX) / 2) + rawDeltaX;
  const translatedCenterY = ((bounds.minY + bounds.maxY) / 2) + rawDeltaY;
  const snapXEnabled = snapEnabled && (!lockAxis || rawDeltaX !== 0);
  const snapYEnabled = snapEnabled && (!lockAxis || rawDeltaY !== 0);
  const snappedEdgesX = resolveTranslatedAxisSnap(
    rawDeltaX,
    [bounds.minX, bounds.maxX],
    GRID_POSITIONS,
    rect?.width ?? 0,
    snapXEnabled,
  );
  const snappedEdgesY = resolveTranslatedAxisSnap(
    rawDeltaY,
    [bounds.minY, bounds.maxY],
    GRID_POSITIONS,
    rect?.height ?? 0,
    snapYEnabled,
  );
  const snappedCenterX = resolveTransformAxisSnap(
    translatedCenterX,
    [EDITOR_CENTER],
    rect?.width ?? 0,
    snapXEnabled,
  );
  const snappedCenterY = resolveTransformAxisSnap(
    translatedCenterY,
    [EDITOR_CENTER],
    rect?.height ?? 0,
    snapYEnabled,
  );
  const centerDeltaX = rawDeltaX + snappedCenterX.value - translatedCenterX;
  const centerDeltaY = rawDeltaY + snappedCenterY.value - translatedCenterY;
  const usesCenterX = snappedCenterX.target !== null && (
    snappedEdgesX.target === null
    || Math.abs(centerDeltaX - rawDeltaX) <= Math.abs(snappedEdgesX.value - rawDeltaX)
  );
  const usesCenterY = snappedCenterY.target !== null && (
    snappedEdgesY.target === null
    || Math.abs(centerDeltaY - rawDeltaY) <= Math.abs(snappedEdgesY.value - rawDeltaY)
  );
  const requestedDeltaX = usesCenterX ? centerDeltaX : snappedEdgesX.value;
  const requestedDeltaY = usesCenterY ? centerDeltaY : snappedEdgesY.value;
  const interactionInset = COORDINATE_RANGE * TRANSFORM_HANDLE_INSET_PERCENT / 100;
  const startCenterX = (bounds.minX + bounds.maxX) / 2;
  const startCenterY = (bounds.minY + bounds.maxY) / 2;
  const deltaX = clamp(
    requestedDeltaX,
    PATH_COORDINATE_MIN + interactionInset - startCenterX,
    PATH_COORDINATE_MAX - interactionInset - startCenterX,
  );
  const deltaY = clamp(
    requestedDeltaY,
    PATH_COORDINATE_MIN + interactionInset - startCenterY,
    PATH_COORDINATE_MAX - interactionInset - startCenterY,
  );
  const appliesSnapX = Math.abs(deltaX - requestedDeltaX) <= Number.EPSILON;
  const appliesSnapY = Math.abs(deltaY - requestedDeltaY) <= Number.EPSILON;
  const alignmentGuides = {
    x: appliesSnapX ? (usesCenterX ? EDITOR_CENTER : snappedEdgesX.target) : null,
    y: appliesSnapY ? (usesCenterY ? EDITOR_CENTER : snappedEdgesY.target) : null,
  };
  return {
    alignmentGuides,
    transform: composePathTransform(
      toTranslationTransform(deltaX, deltaY),
      startTransform,
    ),
    snapSignature: null,
  };
};

export const resolveSelectedAnchorsMove = (
  rect: DOMRect | undefined,
  transform: Readonly<PathTransform>,
  startAnchors: readonly PathAnchor[],
  anchorIds: readonly string[],
  startPoint: EditorPoint,
  point: EditorPoint,
  lockAxis: boolean,
  snapEnabled: boolean,
): { anchors: PathAnchor[]; alignmentGuides: AlignmentGuides } | null => {
  const selectedIds = new Set(anchorIds);
  const selectedAnchors = startAnchors.filter((anchor) => selectedIds.has(anchor.id));
  const unselectedAnchors = startAnchors.filter((anchor) => !selectedIds.has(anchor.id));
  if (selectedAnchors.length === 0) {
    return null;
  }
  const rawDelta = resolveTranslationDelta(startPoint, point, lockAxis);
  const snappedDeltaX = resolveTranslatedAxisSnap(
    rawDelta.x,
    selectedAnchors.map((anchor) => toWorldPoint(anchor, transform).x),
    unselectedAnchors.map((anchor) => toWorldPoint(anchor, transform).x),
    rect?.width ?? 0,
    snapEnabled && (!lockAxis || rawDelta.x !== 0),
  );
  const snappedDeltaY = resolveTranslatedAxisSnap(
    rawDelta.y,
    selectedAnchors.map((anchor) => toWorldPoint(anchor, transform).y),
    unselectedAnchors.map((anchor) => toWorldPoint(anchor, transform).y),
    rect?.height ?? 0,
    snapEnabled && (!lockAxis || rawDelta.y !== 0),
  );
  const inverse = invertAffine(toPathAffine(transform));
  if (!inverse) {
    return null;
  }
  const requestedLocalDelta = {
    x: inverse.a * snappedDeltaX.value + inverse.b * snappedDeltaY.value,
    y: inverse.c * snappedDeltaX.value + inverse.d * snappedDeltaY.value,
  };
  return {
    alignmentGuides: { x: snappedDeltaX.target, y: snappedDeltaY.target },
    anchors: startAnchors.map((anchor) => selectedIds.has(anchor.id)
      ? {
        ...anchor,
        x: roundCoordinate(anchor.x + requestedLocalDelta.x),
        y: roundCoordinate(anchor.y + requestedLocalDelta.y),
      }
      : anchor),
  };
};

export const resolvePathRotation = (
  rect: DOMRect | undefined,
  startTransform: Readonly<PathTransform>,
  center: EditorPoint,
  angle: number,
  startRotationRadians: number,
  point: EditorPoint,
  lockToIncrement: boolean,
  snapEnabled: boolean,
): PathTransformUpdate => {
  const requestedRotation = startRotationRadians + angle;
  const radiusPx = rect
    ? Math.hypot(
        (point.x - center.x) * rect.width / COORDINATE_RANGE,
        (point.y - center.y) * rect.height / COORDINATE_RANGE,
      )
    : Number.POSITIVE_INFINITY;
  const rotationSnap = resolveRotationSnap({
    requestedRadians: requestedRotation,
    radiusPx,
    lockToIncrement,
    snapEnabled,
  });
  const resolvedRotation = rotationSnap.radians;
  const rawDegrees = resolvedRotation * 180 / Math.PI;
  const resolvedRotationDegrees = ((rawDegrees + 180) % 360 + 360) % 360 - 180;
  const resolvedAngle = resolvedRotation - startRotationRadians;
  return {
    transform: composePathTransform(
      toRotateTransformAt(resolvedAngle * 180 / Math.PI, center),
      startTransform,
    ),
    alignmentGuides: { x: null, y: null },
    snapSignature: rotationSnap.snapped
      ? `rotation:${Math.round(resolvedRotationDegrees)}`
      : null,
  };
};

export const resolvePathScale = (
  rect: DOMRect | undefined,
  startTransform: Readonly<PathTransform>,
  fixedPoint: EditorPoint,
  startVector: EditorPoint,
  point: EditorPoint,
  lockAspectRatio: boolean,
  snapEnabled: boolean,
): PathTransformUpdate | null => {
  const snapTargets: AlignmentGuides = { x: null, y: null };
  const hasX = Math.abs(startVector.x) > Number.EPSILON;
  const hasY = Math.abs(startVector.y) > Number.EPSILON;
  if (!hasX && !hasY) {
    return null;
  }
  const scaleReference = setPathScalesAt(
    startTransform,
    startTransform.scaleX === 0 ? 1 : startTransform.scaleX,
    startTransform.scaleY === 0 ? 1 : startTransform.scaleY,
    fixedPoint,
  );
  const referenceAffine = toPathAffine(scaleReference);
  const inverse = invertAffine(referenceAffine);
  if (!inverse) {
    return null;
  }
  const localPoint = applyAffine(inverse, point);
  const currentVector = {
    x: localPoint.x - fixedPoint.x,
    y: localPoint.y - fixedPoint.y,
  };
  const xVectorLengthPx = hasX
    ? resolveTransformedVectorLengthPx(
      scaleReference,
      { x: startVector.x, y: 0 },
      rect,
    )
    : 0;
  const yVectorLengthPx = hasY
    ? resolveTransformedVectorLengthPx(
      scaleReference,
      { x: 0, y: startVector.y },
      rect,
    )
    : 0;
  const minimumScaleX = xVectorLengthPx > Number.EPSILON
    ? Math.min(1, MIN_PATH_SCALE_SIZE_PX / xVectorLengthPx)
    : 1;
  const minimumScaleY = yVectorLengthPx > Number.EPSILON
    ? Math.min(1, MIN_PATH_SCALE_SIZE_PX / yVectorLengthPx)
    : 1;
  let scaleX: number;
  let scaleY: number;
  if (lockAspectRatio) {
    const denominator = startVector.x ** 2 + startVector.y ** 2;
    const requestedScale = (
      currentVector.x * startVector.x + currentVector.y * startVector.y
    ) / denominator;
    const minimumScale = Math.max(
      hasX ? minimumScaleX : 0,
      hasY ? minimumScaleY : 0,
    );
    let scale = resolveSignedMinimumScale(requestedScale, minimumScale);
    if (snapEnabled && rect) {
      const worldFixedPoint = applyAffine(referenceAffine, fixedPoint);
      const worldStartPoint = applyAffine(referenceAffine, {
        x: fixedPoint.x + startVector.x,
        y: fixedPoint.y + startVector.y,
      });
      const worldVector = {
        x: worldStartPoint.x - worldFixedPoint.x,
        y: worldStartPoint.y - worldFixedPoint.y,
      };
      const rawHandle = {
        x: worldFixedPoint.x + worldVector.x * scale,
        y: worldFixedPoint.y + worldVector.y * scale,
      };
      let nearest: {
        scale: number;
        distancePx: number;
        axis: 'x' | 'y';
        target: number;
      } | null = null;
      const considerTarget = (targetScale: number, axis: 'x' | 'y', target: number): void => {
        if (Math.abs(targetScale) < minimumScale) {
          return;
        }
        const targetHandle = {
          x: worldFixedPoint.x + worldVector.x * targetScale,
          y: worldFixedPoint.y + worldVector.y * targetScale,
        };
        const distancePx = Math.hypot(
          (targetHandle.x - rawHandle.x) * rect.width / COORDINATE_RANGE,
          (targetHandle.y - rawHandle.y) * rect.height / COORDINATE_RANGE,
        );
        if (
          distancePx <= PATH_TRANSFORM_SNAP_DISTANCE_PX
          && (!nearest || distancePx < nearest.distancePx)
        ) {
          nearest = { scale: targetScale, distancePx, axis, target };
        }
      };
      if (Math.abs(worldVector.x) > Number.EPSILON) {
        for (const target of SCALE_SNAP_VALUES) {
          considerTarget((target - worldFixedPoint.x) / worldVector.x, 'x', target);
        }
      }
      if (Math.abs(worldVector.y) > Number.EPSILON) {
        for (const target of SCALE_SNAP_VALUES) {
          considerTarget((target - worldFixedPoint.y) / worldVector.y, 'y', target);
        }
      }
      if (nearest) {
        scale = nearest.scale;
        snapTargets[nearest.axis] = nearest.target;
      }
    }
    scaleX = hasX ? scale : 1;
    scaleY = hasY ? scale : 1;
  } else {
    const snappedX = resolveTransformAxisSnap(
      point.x,
      SCALE_SNAP_VALUES,
      rect?.width ?? 0,
      snapEnabled,
    );
    const snappedY = resolveTransformAxisSnap(
      point.y,
      SCALE_SNAP_VALUES,
      rect?.height ?? 0,
      snapEnabled,
    );
    snapTargets.x = snappedX.target;
    snapTargets.y = snappedY.target;
    const snappedLocalPoint = applyAffine(inverse, {
      x: snappedX.value,
      y: snappedY.value,
    });
    const rawScaleX = hasX
      ? (localPoint.x - fixedPoint.x) / startVector.x
      : 1;
    const rawScaleY = hasY
      ? (localPoint.y - fixedPoint.y) / startVector.y
      : 1;
    const snappedScaleX = hasX
      ? (snappedLocalPoint.x - fixedPoint.x) / startVector.x
      : 1;
    const snappedScaleY = hasY
      ? (snappedLocalPoint.y - fixedPoint.y) / startVector.y
      : 1;
    scaleX = hasX
      ? resolveSignedMinimumScale(
        Math.abs(snappedScaleX) < minimumScaleX ? rawScaleX : snappedScaleX,
        minimumScaleX,
      )
      : 1;
    scaleY = hasY
      ? resolveSignedMinimumScale(
        Math.abs(snappedScaleY) < minimumScaleY ? rawScaleY : snappedScaleY,
        minimumScaleY,
      )
      : 1;
  }
  const transform = sanitizePathTransform(setPathScalesAt(
    scaleReference,
    scaleReference.scaleX * scaleX,
    scaleReference.scaleY * scaleY,
    fixedPoint,
  ));
  const appliedHandle = toWorldPoint({
    x: fixedPoint.x + startVector.x,
    y: fixedPoint.y + startVector.y,
  }, transform);
  const snapSignature = (['x', 'y'] as const).map((axis) => {
    const target = snapTargets[axis];
    const canMoveOnAxis = (hasX && Math.abs(referenceAffine[axis === 'x' ? 'a' : 'c']) > Number.EPSILON)
      || (hasY && Math.abs(referenceAffine[axis === 'x' ? 'b' : 'd']) > Number.EPSILON);
    return target !== null && canMoveOnAxis && roundCoordinate(appliedHandle[axis]) === target
      ? `${axis}:${target}` : '';
  }).filter(Boolean).join('|') || null;
  return { transform, alignmentGuides: { x: null, y: null }, snapSignature };
};

