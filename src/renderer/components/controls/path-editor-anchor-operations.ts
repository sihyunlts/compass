import { createPathAnchorId } from '../../../devices/path/schema';
import { evaluateCubicBezier, resolveAbsolutePathHandle } from '../../../core/generators/path';
import { clonePathAnchors, type PathAnchor, type PathTransform } from '../../../shared/model';
import type { BezierHandleKind as HandleKind } from '../../../shared/bezier-handles';
import { lerp, resolveNearestSegmentSample } from './path-editor-geometry';
import type { EditorPoint } from './path-editor-types';

export const resolveDraggedHandleKind = (
  anchors: readonly PathAnchor[],
  closed: boolean,
  anchorId: string,
  point: EditorPoint,
): HandleKind => {
  const index = anchors.findIndex((anchor) => anchor.id === anchorId);
  const anchor = anchors[index];
  if (!anchor) {
    return 'handleOut';
  }
  const previous = anchors[index - 1]
    ?? (closed ? anchors.at(-1) : undefined);
  const next = anchors[index + 1]
    ?? (closed ? anchors[0] : undefined);
  const drag = { x: point.x - anchor.x, y: point.y - anchor.y };
  const normalizedDirection = (neighbor: PathAnchor | undefined): EditorPoint | null => {
    if (!neighbor) {
      return null;
    }
    const x = neighbor.x - anchor.x;
    const y = neighbor.y - anchor.y;
    const length = Math.hypot(x, y);
    return length > Number.EPSILON ? { x: x / length, y: y / length } : null;
  };
  const previousDirection = normalizedDirection(previous);
  const nextDirection = normalizedDirection(next);
  const dot = (left: EditorPoint, right: EditorPoint | null): number =>
    right ? left.x * right.x + left.y * right.y : 0;
  const oppositeDrag = { x: -drag.x, y: -drag.y };
  const pointerAsOutScore = dot(drag, nextDirection) + dot(oppositeDrag, previousDirection);
  const pointerAsInScore = dot(oppositeDrag, nextDirection) + dot(drag, previousDirection);
  return pointerAsOutScore >= pointerAsInScore ? 'handleOut' : 'handleIn';
};

export const mergePathAnchors = (
  anchors: readonly PathAnchor[],
  closed: boolean,
  draggedAnchorId: string,
  targetAnchorId: string,
  closePath: boolean,
): PathAnchor[] | null => {
  const draggedIndex = anchors.findIndex((anchor) => anchor.id === draggedAnchorId);
  const targetIndex = anchors.findIndex((anchor) => anchor.id === targetAnchorId);
  const dragged = anchors[draggedIndex];
  const target = anchors[targetIndex];
  if (!dragged || !target || draggedIndex === targetIndex) {
    return null;
  }

  const draggedBeforeTarget = targetIndex === draggedIndex + 1
    || (closed && draggedIndex === anchors.length - 1 && targetIndex === 0);
  const targetBeforeDragged = draggedIndex === targetIndex + 1
    || (closed && targetIndex === anchors.length - 1 && draggedIndex === 0);
  if (!closePath && !draggedBeforeTarget && !targetBeforeDragged) {
    return null;
  }
  const transferredHandleKind: HandleKind = closePath
    ? draggedIndex === 0 ? 'handleOut' : 'handleIn'
    : draggedBeforeTarget ? 'handleIn' : 'handleOut';
  const mergedTarget = { ...target };
  const transferredHandle = dragged[transferredHandleKind];
  if (transferredHandle) {
    mergedTarget[transferredHandleKind] = { ...transferredHandle };
  } else {
    delete mergedTarget[transferredHandleKind];
  }
  const next = anchors
    .filter((anchor) => anchor.id !== draggedAnchorId)
    .map((anchor) => anchor.id === targetAnchorId ? mergedTarget : anchor);
  return next;
};

export const insertPathAnchorInSegment = (
  anchors: readonly PathAnchor[],
  transform: Readonly<PathTransform>,
  segmentIndex: number,
  point: EditorPoint,
): { anchors: PathAnchor[]; insertedAnchorId: string } | null => {
  const startIndex = segmentIndex;
  const endIndex = segmentIndex === anchors.length - 1 ? 0 : segmentIndex + 1;
  const start = anchors[startIndex];
  const end = anchors[endIndex];
  if (!start || !end) {
    return null;
  }
  const { t } = resolveNearestSegmentSample(transform, start, end, point);
  const p0 = { x: start.x, y: start.y };
  const p1 = resolveAbsolutePathHandle(start, start.handleOut);
  const p2 = resolveAbsolutePathHandle(end, end.handleIn);
  const p3 = { x: end.x, y: end.y };
  if (!start.handleOut && !end.handleIn) {
    const split = evaluateCubicBezier(p0, p1, p2, p3, t);
    const inserted: PathAnchor = {
      id: createPathAnchorId(),
      x: split.x,
      y: split.y,
    };
    const nextAnchors = clonePathAnchors(anchors);
    nextAnchors.splice(startIndex + 1, 0, inserted);
    return { anchors: nextAnchors, insertedAnchorId: inserted.id };
  }
  const q0 = lerp(p0, p1, t);
  const q1 = lerp(p1, p2, t);
  const q2 = lerp(p2, p3, t);
  const r0 = lerp(q0, q1, t);
  const r1 = lerp(q1, q2, t);
  const split = lerp(r0, r1, t);
  const nextAnchors = clonePathAnchors(anchors);
  nextAnchors[startIndex] = {
    ...nextAnchors[startIndex],
    handleOut: { x: q0.x - p0.x, y: q0.y - p0.y },
  };
  nextAnchors[endIndex] = {
    ...nextAnchors[endIndex],
    handleIn: { x: q2.x - p3.x, y: q2.y - p3.y },
  };
  const inserted: PathAnchor = {
    id: createPathAnchorId(),
    x: split.x,
    y: split.y,
    handleIn: { x: r0.x - split.x, y: r0.y - split.y },
    handleOut: { x: r1.x - split.x, y: r1.y - split.y },
  };
  const insertionIndex = startIndex + 1;
  nextAnchors.splice(insertionIndex, 0, inserted);
  return { anchors: nextAnchors, insertedAnchorId: inserted.id };
};

export const deletePathAnchors = (
  anchors: readonly PathAnchor[],
  closed: boolean,
  anchorIds: readonly string[],
): { anchors: PathAnchor[]; selectedAnchorId: string | null } | null => {
  const selectedIds = new Set(anchorIds);
  const selectedIndices = anchors.flatMap((anchor, index) =>
    selectedIds.has(anchor.id) ? [index] : []);
  if (selectedIndices.length === 0) {
    return null;
  }
  const firstSelectedIndex = Math.min(...selectedIndices);
  const remaining = anchors.filter((anchor) => !selectedIds.has(anchor.id));
  const rotationIndex = remaining.length > 0 ? firstSelectedIndex % remaining.length : 0;
  const next = closed
    ? [
      ...remaining.slice(rotationIndex),
      ...remaining.slice(0, rotationIndex),
    ]
    : remaining;
  const selected = closed
    ? next[0]
    : next[Math.min(firstSelectedIndex, next.length - 1)];
  return { anchors: next, selectedAnchorId: selected?.id ?? null };
};
