import {
  resolveDraggedHandleKind,
  mergePathAnchors,
  insertPathAnchorInSegment,
  deletePathAnchors,
} from './path-editor-anchor-operations';
import { ControlPointPointerSession, ControlPointSnapFeedback } from './control-point-interaction';
import { isConsecutiveTap, TAP_WINDOW_MS } from '../../features/drag-gesture';
import {
  IDENTITY_PATH_TRANSFORM,
  createPathAnchorId,
  sanitizePathAnchors,
  sanitizePathTransform,
} from '../../../devices/path/schema';
import { clonePathAnchors, type PathAnchor, type PathTransform } from '../../../shared/model';
import { moveBezierHandle, type BezierHandleKind as HandleKind } from '../../../shared/bezier-handles';
import {
  CONTROL_POINT_DRAG_THRESHOLD_PX,
  CONTROL_POINT_SOFT_SNAP_DISTANCE_PX,
  hasExceededControlPointDragThreshold,
} from './control-point-editor';
import {
  COORDINATE_RANGE,
  roundCoordinate,
  resolveEditorPointFromClient,
  toPlotPoint,
  resolveWorldPathBounds,
  resolveNearestSegmentSample,
  toWorldPoint as transformPoint,
  toLocalPoint as inverseTransformPoint,
} from './path-editor-geometry';
import {
  resolvePathMove,
  resolveSelectedAnchorsMove,
  resolvePathRotation,
  resolvePathScale,
  type PathTransformUpdate,
} from './path-editor-transforms';
import type {
  EditorPoint,
  SnappedEditorPoint,
  AlignmentGuides,
  Selection,
  DragTarget,
  PathEditorInput,
} from './path-editor-types';
import { createPathEditorView } from './path-editor-view.svelte';

/** Owns edit state and gestures; initialize once within the component lifecycle. */
export const createPathEditorController = (input: PathEditorInput) => {
  const pointerSession = new ControlPointPointerSession();
  let pointerDownEvent: PointerEvent | null = null;
  let previousTap: PointerEvent | null = null;
  const resolvePressTarget = (event: PointerEvent): Element | null => event.target instanceof Element
    ? event.target.closest('.path-editor-interactive, [data-bezier-handle]') ?? editorEl
    : null;
  const isRepeatedPress = (event: PointerEvent): boolean => isConsecutiveTap(previousTap, event)
    && previousTap !== null && resolvePressTarget(previousTap) === resolvePressTarget(event);
  const canBeginPointer = (event: PointerEvent): boolean => !input.readonly && pointerSession.canBegin(event);
  let editorEl = $state<HTMLDivElement | null>(null);
  let localAnchors = $state<PathAnchor[]>(sanitizePathAnchors([]));
  let localClosed = $state(false);
  let localTransform = $state<PathTransform>({ ...IDENTITY_PATH_TRANSFORM });
  let selection = $state<Selection>(null);
  let drawingEndpoint = $state<'start' | 'end' | null>(null);
  let dragTarget = $state<DragTarget>(null);
  let pointerDownClientX = $state(0);
  let pointerDownClientY = $state(0);
  let pointerDidMove = $state(false);
  let pendingMergeTargetId = $state<string | null>(null);
  let connectionOriginAnchorId = $state<string | null>(null);
  let pendingAppendEndpoint = $state<'start' | 'end' | null>(null);
  let alignmentGuides = $state<AlignmentGuides>({ x: null, y: null });
  const snapFeedback = new ControlPointSnapFeedback();

  const toWorldPoint = (point: Readonly<EditorPoint>): EditorPoint => transformPoint(point, localTransform);
  const toLocalPoint = (point: Readonly<EditorPoint>): EditorPoint | null => inverseTransformPoint(point, localTransform);

  const resolveSnappedEditorPoint = (
    clientX: number,
    clientY: number,
  ): SnappedEditorPoint | null => {
    const worldPoint = resolveEditorPointFromClient(editorEl?.getBoundingClientRect(), clientX, clientY, true);
    const localPoint = worldPoint ? toLocalPoint(worldPoint.point) : null;
    return worldPoint && localPoint
      ? {
        point: { x: roundCoordinate(localPoint.x), y: roundCoordinate(localPoint.y) },
        snapSignature: worldPoint.snapSignature,
      }
      : null;
  };

  const resolveEditorPoint = (clientX: number, clientY: number): EditorPoint | null =>
    resolveSnappedEditorPoint(clientX, clientY)?.point ?? null;

  const resolveUnsnappedEditorPoint = (
    clientX: number,
    clientY: number,
  ): EditorPoint | null => resolveEditorPointFromClient(editorEl?.getBoundingClientRect(), clientX, clientY, false)?.point ?? null;

  const resolveUnboundedEditorPoint = (
    clientX: number,
    clientY: number,
  ): EditorPoint | null => resolveEditorPointFromClient(editorEl?.getBoundingClientRect(), clientX, clientY, false, false)?.point ?? null;

  const view = createPathEditorView({
    get anchors() { return localAnchors; },
    get closed() { return localClosed; },
    get transform() { return localTransform; },
    get pendingMergeTargetId() { return pendingMergeTargetId; },
    get selection() { return selection; },
    get dragTarget() { return dragTarget; },
    get pointerDidMove() { return pointerDidMove; },
    get alignmentGuides() { return alignmentGuides; },
  }, input);

  const emitGeometry = (
    nextAnchors: readonly PathAnchor[],
    nextClosed: boolean,
    finalize: boolean,
    nextTransform: Readonly<PathTransform> = localTransform,
    anchorIdReplacement?: { from: string; to: string },
  ): void => {
    localAnchors = sanitizePathAnchors(nextAnchors);
    localClosed = nextClosed;
    localTransform = localAnchors.length > 0
      ? sanitizePathTransform(nextTransform)
      : { ...IDENTITY_PATH_TRANSFORM };
    input.onControlChange({
      action: 'set-path-geometry',
      deviceId: input.deviceId,
      value: {
        anchors: localAnchors,
        closed: localClosed,
        transform: localTransform,
        ...(anchorIdReplacement ? { anchorIdReplacement } : {}),
      },
      finalize,
    });
  };

  const replaceAnchor = (
    anchorId: string,
    updater: (anchor: PathAnchor) => PathAnchor,
    finalize: boolean,
  ): void => {
    emitGeometry(
      localAnchors.map((anchor) => anchor.id === anchorId ? updater({ ...anchor }) : anchor),
      localClosed,
      finalize,
    );
  };

  const moveAnchor = (anchorId: string, point: EditorPoint): void => {
    replaceAnchor(anchorId, (anchor) => ({
      ...anchor,
      x: roundCoordinate(point.x),
      y: roundCoordinate(point.y),
    }), false);
  };

  const isPointNearAnchor = (
    point: EditorPoint,
    anchor: PathAnchor,
    distancePx: number,
  ): boolean => {
    if (!editorEl) {
      return false;
    }
    const rect = editorEl.getBoundingClientRect();
    const worldPoint = toWorldPoint(point);
    const worldAnchor = toWorldPoint(anchor);
    const deltaX = (worldPoint.x - worldAnchor.x) * rect.width / COORDINATE_RANGE;
    const deltaY = (worldPoint.y - worldAnchor.y) * rect.height / COORDINATE_RANGE;
    return Math.hypot(deltaX, deltaY) <= distancePx;
  };

  const moveHandle = (
    anchorId: string,
    kind: HandleKind,
    point: EditorPoint,
    independent: boolean,
  ): void => {
    replaceAnchor(anchorId, (anchor) => {
      const offset = isPointNearAnchor(point, anchor, CONTROL_POINT_DRAG_THRESHOLD_PX)
        ? null : { x: roundCoordinate(point.x - anchor.x), y: roundCoordinate(point.y - anchor.y) };
      const handles = moveBezierHandle(anchor, kind, offset, independent);
      return { id: anchor.id, x: anchor.x, y: anchor.y, ...handles };
    }, false);
  };

  const resolveMergeTarget = (
    anchorId: string,
    clientX: number,
    clientY: number,
  ): PathAnchor | null => {
    if (localAnchors.length < 2 || !editorEl) {
      return null;
    }
    const index = localAnchors.findIndex((anchor) => anchor.id === anchorId);
    if (index < 0) {
      return null;
    }
    const rect = editorEl.getBoundingClientRect();
    const candidateIndices = [index - 1, index + 1];
    if (localClosed) {
      candidateIndices.push(
        (index - 1 + localAnchors.length) % localAnchors.length,
        (index + 1) % localAnchors.length,
      );
    } else if (localAnchors.length >= 3) {
      if (index === 0) {
        candidateIndices.push(localAnchors.length - 1);
      } else if (index === localAnchors.length - 1) {
        candidateIndices.push(0);
      }
    }
    let nearest: PathAnchor | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const candidateIndex of candidateIndices) {
      const target = localAnchors[candidateIndex];
      if (!target || target.id === anchorId || target.id === nearest?.id) {
        continue;
      }
      const targetPlot = toPlotPoint(toWorldPoint(target));
      const targetClientX = rect.left + targetPlot.x * rect.width / 100;
      const targetClientY = rect.top + targetPlot.y * rect.height / 100;
      const distance = Math.hypot(clientX - targetClientX, clientY - targetClientY);
      if (distance <= CONTROL_POINT_SOFT_SNAP_DISTANCE_PX && distance < nearestDistance) {
        nearest = target;
        nearestDistance = distance;
      }
    }
    return nearest;
  };

  const mergeAnchors = (
    draggedAnchorId: string,
    targetAnchorId: string,
    closePath: boolean,
  ): void => {
    const next = mergePathAnchors(localAnchors, localClosed, draggedAnchorId, targetAnchorId, closePath);
    if (!next) return;
    const survivingTargetIndex = next.findIndex((anchor) => anchor.id === targetAnchorId);
    emitGeometry(
      next,
      closePath || localClosed,
      true,
      localTransform,
      { from: draggedAnchorId, to: targetAnchorId },
    );
    selection = { kind: 'anchors', anchorIds: [targetAnchorId] };
    drawingEndpoint = closePath
      ? null
      : !localClosed && survivingTargetIndex === 0
      ? 'start'
      : !localClosed && survivingTargetIndex === next.length - 1
        ? 'end'
        : null;
    connectionOriginAnchorId = null;
  };

  const applyTransformUpdate = (update: PathTransformUpdate | null): string | null => {
    if (!update) return null;
    alignmentGuides = update.alignmentGuides;
    emitGeometry(localAnchors, localClosed, false, update.transform);
    return update.snapSignature;
  };

  const appendAnchor = (
    endpoint: 'start' | 'end',
    point: EditorPoint,
  ): void => {
    const anchor: PathAnchor = {
      id: createPathAnchorId(),
      x: point.x,
      y: point.y,
    };
    const next = endpoint === 'end'
      ? [...localAnchors, anchor]
      : [anchor, ...localAnchors];
    const wasClosed = localClosed;
    emitGeometry(next, wasClosed, true);
    selection = { kind: 'anchors', anchorIds: [anchor.id] };
    drawingEndpoint = wasClosed ? null : endpoint;
  };

  const resolveNearestEndpoint = (point: EditorPoint): 'start' | 'end' => {
    const start = localAnchors[0];
    const end = localAnchors.at(-1);
    if (!start || !end) {
      return 'end';
    }
    const startDistance = (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
    const endDistance = (point.x - end.x) ** 2 + (point.y - end.y) ** 2;
    return startDistance < endDistance ? 'start' : 'end';
  };

  const selectCoincidentAnchor = (point: EditorPoint): boolean => {
    const index = localAnchors.findIndex((anchor) =>
      isPointNearAnchor(point, anchor, CONTROL_POINT_DRAG_THRESHOLD_PX));
    const anchor = localAnchors[index];
    if (!anchor) {
      return false;
    }
    selection = { kind: 'anchors', anchorIds: [anchor.id] };
    drawingEndpoint = !localClosed && index === 0
      ? 'start'
      : !localClosed && index === localAnchors.length - 1
        ? 'end'
        : null;
    return true;
  };

  const insertAnchorNearClosedSegment = (point: EditorPoint): void => {
    if (localAnchors.length < 2) {
      appendAnchor('end', point);
      return;
    }
    let nearestSegmentIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < localAnchors.length; index += 1) {
      const start = localAnchors[index];
      const end = localAnchors[(index + 1) % localAnchors.length];
      const { distanceSquared } = resolveNearestSegmentSample(localTransform, start, end, point);
      if (distanceSquared < nearestDistance) {
        nearestDistance = distanceSquared;
        nearestSegmentIndex = index;
      }
    }
    const anchor: PathAnchor = {
      id: createPathAnchorId(),
      x: point.x,
      y: point.y,
    };
    const nextAnchors = clonePathAnchors(localAnchors);
    nextAnchors.splice(nearestSegmentIndex + 1, 0, anchor);
    emitGeometry(nextAnchors, true, true);
    selection = { kind: 'anchors', anchorIds: [anchor.id] };
    drawingEndpoint = null;
  };

  const beginDrag = (event: PointerEvent, target: DragTarget): void => {
    if (!canBeginPointer(event) || !editorEl) return;
    snapFeedback.reset();
    pointerDownEvent = event;
    pointerSession.begin(event.currentTarget instanceof Element ? event.currentTarget : editorEl, event);
    editorEl.focus({ preventScroll: true });
    dragTarget = target;
    pointerDownClientX = event.clientX;
    pointerDownClientY = event.clientY;
    pointerDidMove = false;
    pendingMergeTargetId = null;
    alignmentGuides = { x: null, y: null };
    event.preventDefault();
    event.stopPropagation();
  };

  const handleBezierHandlePointerDown = (
    event: PointerEvent,
    anchorId: string,
    handleKind: HandleKind,
  ): void => {
    beginDrag(event, { kind: 'handle', anchorId, handleKind });
  };

  const beginPathMove = (event: PointerEvent): void => {
    if (!canBeginPointer(event)) return;
    const startPoint = resolveUnboundedEditorPoint(event.clientX, event.clientY);
    const startBounds = resolveWorldPathBounds(localAnchors, localClosed, localTransform);
    if (!startPoint || !startBounds) {
      return;
    }
    selection = { kind: 'path' };
    drawingEndpoint = null;
    connectionOriginAnchorId = null;
    beginDrag(event, {
      kind: 'path-move',
      startPoint,
      startTransform: { ...localTransform },
      startBounds,
    });
  };

  const beginSelectedAnchorsMove = (
    event: PointerEvent,
    anchorIds: string[],
  ): void => {
    if (!canBeginPointer(event)) return;
    const startPoint = resolveUnsnappedEditorPoint(event.clientX, event.clientY);
    if (!startPoint) {
      return;
    }
    beginDrag(event, {
      kind: 'anchors-move',
      anchorIds,
      startPoint,
      startAnchors: clonePathAnchors(localAnchors),
    });
  };

  const beginPathRotation = (event: PointerEvent): void => {
    if (!canBeginPointer(event)) return;
    if (!view.pathSelection) {
      return;
    }
    const point = resolveUnboundedEditorPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    beginDrag(event, {
      kind: 'path-rotate',
      center: view.pathSelection.center,
      startAngle: Math.atan2(
        point.y - view.pathSelection.center.y,
        point.x - view.pathSelection.center.x,
      ),
      startRotationRadians: Math.atan2(localTransform.c, localTransform.a),
      startTransform: { ...localTransform },
    });
  };

  const beginPathScale = (
    event: PointerEvent,
    handle: { point: EditorPoint; fixedPoint: EditorPoint },
  ): void => {
    if (!canBeginPointer(event)) return;
    const pointerPoint = resolveUnboundedEditorPoint(event.clientX, event.clientY);
    if (!pointerPoint) {
      return;
    }
    const actualPoint = toWorldPoint(handle.point);
    beginDrag(event, {
      kind: 'path-scale',
      fixedPoint: handle.fixedPoint,
      startVector: {
        x: handle.point.x - handle.fixedPoint.x,
        y: handle.point.y - handle.fixedPoint.y,
      },
      startTransform: { ...localTransform },
      pointerOffset: {
        x: actualPoint.x - pointerPoint.x,
        y: actualPoint.y - pointerPoint.y,
      },
    });
  };

  const clearEditorFocus = (preserveAppendEndpoint = false): void => {
    selection = null;
    drawingEndpoint = null;
    pendingMergeTargetId = null;
    connectionOriginAnchorId = null;
    alignmentGuides = { x: null, y: null };
    if (!preserveAppendEndpoint) {
      pendingAppendEndpoint = null;
    }
  };

  const handleSurfacePointerDown = (event: PointerEvent): void => {
    if (!canBeginPointer(event)) return;
    const target = event.target;
    if (target instanceof Element && target.closest('.path-editor-interactive, [data-bezier-handle]')) {
      return;
    }
    const startPoint = resolveUnsnappedEditorPoint(event.clientX, event.clientY);
    if (!startPoint) {
      return;
    }
    if (!isRepeatedPress(event)) {
      pendingAppendEndpoint = drawingEndpoint;
    }
    const additiveAnchorIds = event.shiftKey && selection?.kind === 'anchors'
      ? [...selection.anchorIds]
      : [];
    if (!event.shiftKey) {
      clearEditorFocus(true);
    } else {
      drawingEndpoint = null;
      pendingMergeTargetId = null;
      connectionOriginAnchorId = null;
    }
    beginDrag(event, {
      kind: 'marquee',
      startPoint,
      currentPoint: startPoint,
      additiveAnchorIds,
    });
  };

  const handleSurfaceDoubleClick = (event: MouseEvent): void => {
    if (input.readonly || event.button !== 0) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest('.path-editor-interactive, [data-bezier-handle]')) {
      return;
    }
    const point = resolveEditorPoint(event.clientX, event.clientY);
    if (point) {
      event.preventDefault();
      event.stopPropagation();
      if (selectCoincidentAnchor(point)) {
        pendingAppendEndpoint = null;
        return;
      }
      if (localClosed) {
        insertAnchorNearClosedSegment(point);
      } else {
        appendAnchor(pendingAppendEndpoint ?? resolveNearestEndpoint(point), point);
      }
      pendingAppendEndpoint = null;
    }
  };

  const handleAnchorPointerDown = (event: PointerEvent, anchorId: string): void => {
    if (!canBeginPointer(event)) return;
    if (!isRepeatedPress(event)) {
      connectionOriginAnchorId = drawingEndpoint === 'start'
        ? localAnchors[0]?.id ?? null
        : drawingEndpoint === 'end'
          ? localAnchors.at(-1)?.id ?? null
          : null;
    }
    const currentAnchorIds = selection?.kind === 'anchors'
      ? selection.anchorIds
      : [];
    const wasSelected = currentAnchorIds.includes(anchorId);
    const nextAnchorIds = event.altKey
      ? [anchorId]
      : event.shiftKey
        ? wasSelected
          ? currentAnchorIds.filter((id) => id !== anchorId)
          : [...currentAnchorIds, anchorId]
        : wasSelected && currentAnchorIds.length > 1
          ? currentAnchorIds
          : [anchorId];
    selection = nextAnchorIds.length > 0
      ? { kind: 'anchors', anchorIds: nextAnchorIds }
      : null;
    const singleSelectedIndex = nextAnchorIds.length === 1
      ? localAnchors.findIndex((anchor) => anchor.id === nextAnchorIds[0])
      : -1;
    drawingEndpoint = singleSelectedIndex === 0 && !localClosed
      ? 'start'
      : singleSelectedIndex === localAnchors.length - 1 && !localClosed
        ? 'end'
        : null;

    if (event.shiftKey && wasSelected) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.altKey) {
      beginDrag(event, { kind: 'anchor-handle', anchorId });
    } else if (nextAnchorIds.length > 1) {
      beginSelectedAnchorsMove(event, nextAnchorIds);
    } else {
      beginDrag(event, { kind: 'anchor', anchorId });
    }
  };

  const handleAnchorDoubleClick = (
    event: MouseEvent,
    anchorId: string,
  ): void => {
    if (input.readonly || localClosed || localAnchors.length < 2) {
      return;
    }
    const startAnchorId = localAnchors[0]?.id;
    const endAnchorId = localAnchors.at(-1)?.id;
    const closesPath = (
      connectionOriginAnchorId === startAnchorId && anchorId === endAnchorId
    ) || (
      connectionOriginAnchorId === endAnchorId && anchorId === startAnchorId
    );
    if (!closesPath) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    emitGeometry(localAnchors, true, true);
    selection = { kind: 'path' };
    drawingEndpoint = null;
    connectionOriginAnchorId = null;
  };

  const insertAnchorInSegment = (segmentIndex: number, point: EditorPoint): void => {
    const update = insertPathAnchorInSegment(localAnchors, localTransform, segmentIndex, point);
    if (!update) return;
    emitGeometry(update.anchors, localClosed, true);
    selection = { kind: 'anchors', anchorIds: [update.insertedAnchorId] };
    drawingEndpoint = null;
  };

  const handleSegmentDoubleClick = (event: MouseEvent, segmentIndex: number): void => {
    if (input.readonly) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const point = resolveEditorPoint(event.clientX, event.clientY);
    if (point) {
      insertAnchorInSegment(segmentIndex, point);
    }
  };

  const deleteSelection = (): void => {
    if (input.readonly || !selection) {
      return;
    }
    if (selection.kind === 'path') {
      emitGeometry([], false, true);
      selection = null;
      drawingEndpoint = null;
      pendingMergeTargetId = null;
      connectionOriginAnchorId = null;
      pendingAppendEndpoint = null;
      return;
    }
    const wasClosed = localClosed;
    const update = deletePathAnchors(localAnchors, wasClosed, selection.anchorIds);
    if (!update) return;
    emitGeometry(update.anchors, false, true);
    selection = update.selectedAnchorId
      ? { kind: 'anchors', anchorIds: [update.selectedAnchorId] }
      : null;
    drawingEndpoint = wasClosed ? 'end' : null;
  };

  const handleEditorKeyDown = (event: KeyboardEvent): void => {
    if (input.readonly || event.defaultPrevented) {
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement && (
      target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
    )) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      pointerSession.finish();
      pointerDownEvent = null;
      previousTap = null;
      clearEditorFocus();
      dragTarget = null;
      pointerDidMove = false;
      editorEl?.blur();
      return;
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && selection) {
      event.preventDefault();
      event.stopPropagation();
      deleteSelection();
    }
  };

  $effect(() => {
    if (dragTarget) {
      return;
    }
    const nextAnchors = sanitizePathAnchors(input.anchors);
    localAnchors = nextAnchors;
    localClosed = input.closed;
    localTransform = nextAnchors.length > 0
      ? sanitizePathTransform(input.transform)
      : { ...IDENTITY_PATH_TRANSFORM };
    if (input.closed) {
      drawingEndpoint = null;
      pendingMergeTargetId = null;
      connectionOriginAnchorId = null;
    }
    if (selection?.kind === 'anchors') {
      const validAnchorIds = selection.anchorIds.filter((anchorId) =>
        nextAnchors.some((anchor) => anchor.id === anchorId));
      if (validAnchorIds.length !== selection.anchorIds.length) {
        selection = validAnchorIds.length > 0
          ? { kind: 'anchors', anchorIds: validAnchorIds }
          : null;
      }
    }
  });

  const updateMarqueeDrag = (
    target: Extract<DragTarget, { kind: 'marquee' }>,
    point: EditorPoint,
  ): void => {
    const marquee = target;
    pendingAppendEndpoint = null;
    const minX = Math.min(marquee.startPoint.x, point.x);
    const maxX = Math.max(marquee.startPoint.x, point.x);
    const minY = Math.min(marquee.startPoint.y, point.y);
    const maxY = Math.max(marquee.startPoint.y, point.y);
    const enclosedAnchorIds = localAnchors.flatMap((anchor) => {
      const worldAnchor = toWorldPoint(anchor);
      return worldAnchor.x >= minX
        && worldAnchor.x <= maxX
        && worldAnchor.y >= minY
        && worldAnchor.y <= maxY
        ? [anchor.id]
        : [];
    });
    const anchorIds = [...marquee.additiveAnchorIds];
    for (const anchorId of enclosedAnchorIds) {
      if (!anchorIds.includes(anchorId)) {
        anchorIds.push(anchorId);
      }
    }
    dragTarget = { ...marquee, currentPoint: point };
    selection = localAnchors.length > 0
      && anchorIds.length === localAnchors.length
      ? { kind: 'path' }
      : anchorIds.length > 0
        ? { kind: 'anchors', anchorIds }
        : null;
    drawingEndpoint = null;
    pendingMergeTargetId = null;
    connectionOriginAnchorId = null;
  };

  const updatePathScaleDrag = (
    target: Extract<DragTarget, { kind: 'path-scale' }>,
    point: EditorPoint,
    event: PointerEvent,
  ): void => {
    pendingMergeTargetId = null;
    const scalePoint = {
      x: point.x + target.pointerOffset.x,
      y: point.y + target.pointerOffset.y,
    };
    const scaleFixedPoint = event.altKey
      ? {
        x: target.fixedPoint.x + target.startVector.x / 2,
        y: target.fixedPoint.y + target.startVector.y / 2,
      }
      : target.fixedPoint;
    const scaleStartVector = event.altKey
      ? {
        x: target.startVector.x / 2,
        y: target.startVector.y / 2,
      }
      : target.startVector;
    const scaleSnapSignature = applyTransformUpdate(resolvePathScale(
      editorEl?.getBoundingClientRect(),
      target.startTransform,
      scaleFixedPoint,
      scaleStartVector,
      scalePoint,
      event.shiftKey,
      !event.ctrlKey,
    ));
    snapFeedback.update(scaleSnapSignature);
  };

  const updateSelectedAnchorsDrag = (
    target: Extract<DragTarget, { kind: 'anchors-move' }>,
    point: EditorPoint,
    event: PointerEvent,
  ): void => {
    pendingMergeTargetId = null;
    const update = resolveSelectedAnchorsMove(
      editorEl?.getBoundingClientRect(),
      localTransform,
      target.startAnchors,
      target.anchorIds,
      target.startPoint,
      point,
      event.shiftKey,
      !event.ctrlKey,
    );
    if (update) {
      alignmentGuides = update.alignmentGuides;
      emitGeometry(update.anchors, localClosed, false);
    }
    snapFeedback.update([
      alignmentGuides.x === null ? '' : `x:${alignmentGuides.x}`,
      alignmentGuides.y === null ? '' : `y:${alignmentGuides.y}`,
    ].filter(Boolean).join('|') || null);
  };

  const updatePathMoveDrag = (
    target: Extract<DragTarget, { kind: 'path-move' }>,
    point: EditorPoint,
    event: PointerEvent,
  ): void => {
    pendingMergeTargetId = null;
    applyTransformUpdate(resolvePathMove(
      editorEl?.getBoundingClientRect(),
      target.startTransform,
      target.startBounds,
      target.startPoint,
      point,
      event.shiftKey,
      !event.ctrlKey,
    ));
    snapFeedback.update([
      alignmentGuides.x === null ? '' : `x:${alignmentGuides.x}`,
      alignmentGuides.y === null ? '' : `y:${alignmentGuides.y}`,
    ].filter(Boolean).join('|') || null);
  };

  const updatePathRotationDrag = (
    target: Extract<DragTarget, { kind: 'path-rotate' }>,
    point: EditorPoint,
    event: PointerEvent,
  ): void => {
    pendingMergeTargetId = null;
    const angle = Math.atan2(
      point.y - target.center.y,
      point.x - target.center.x,
    ) - target.startAngle;
    const rotationSnapSignature = applyTransformUpdate(resolvePathRotation(
      editorEl?.getBoundingClientRect(),
      target.startTransform,
      target.center,
      angle,
      target.startRotationRadians,
      point,
      event.shiftKey,
      !event.ctrlKey,
    ));
    snapFeedback.update(rotationSnapSignature);
  };

  const updateAnchorDrag = (
    target: Extract<DragTarget, { kind: 'anchor' }>,
    point: EditorPoint,
    event: PointerEvent,
    snapSignature: string | null,
  ): void => {
    const mergeTarget = resolveMergeTarget(
      target.anchorId,
      event.clientX,
      event.clientY,
    );
    pendingMergeTargetId = mergeTarget?.id ?? null;
    moveAnchor(
      target.anchorId,
      mergeTarget ? { x: mergeTarget.x, y: mergeTarget.y } : point,
    );
    snapFeedback.update(mergeTarget
      ? `merge:${mergeTarget.id}`
      : snapSignature);
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (!dragTarget) {
      return;
    }
    if (!pointerDidMove && hasExceededControlPointDragThreshold(
      event.clientX,
      event.clientY,
      pointerDownClientX,
      pointerDownClientY,
    )) {
      pointerDidMove = true;
    }
    const snappedPoint = dragTarget.kind === 'anchor'
      || dragTarget.kind === 'anchor-handle'
      || dragTarget.kind === 'handle'
      ? resolveSnappedEditorPoint(event.clientX, event.clientY)
      : null;
    const point = dragTarget.kind === 'path-move'
      || dragTarget.kind === 'path-rotate'
      || dragTarget.kind === 'path-scale'
      ? resolveUnboundedEditorPoint(event.clientX, event.clientY)
      : dragTarget.kind === 'anchors-move' || dragTarget.kind === 'marquee'
        ? resolveUnsnappedEditorPoint(event.clientX, event.clientY)
        : snappedPoint?.point ?? null;
    if (!point) {
      return;
    }
    if (!pointerDidMove) {
      return;
    }
    switch (dragTarget.kind) {
      case 'marquee':
        updateMarqueeDrag(dragTarget, point);
        break;
      case 'path-scale':
        updatePathScaleDrag(dragTarget, point, event);
        break;
      case 'anchors-move':
        updateSelectedAnchorsDrag(dragTarget, point, event);
        break;
      case 'path-move':
        updatePathMoveDrag(dragTarget, point, event);
        break;
      case 'path-rotate':
        updatePathRotationDrag(dragTarget, point, event);
        break;
      case 'anchor':
        updateAnchorDrag(dragTarget, point, event, snappedPoint?.snapSignature ?? null);
        break;
      case 'anchor-handle':
        pendingMergeTargetId = null;
        moveHandle(
          dragTarget.anchorId,
          resolveDraggedHandleKind(localAnchors, localClosed, dragTarget.anchorId, point),
          point,
          false,
        );
        snapFeedback.update(snappedPoint?.snapSignature ?? null);
        break;
      case 'handle':
        pendingMergeTargetId = null;
        moveHandle(dragTarget.anchorId, dragTarget.handleKind, point, event.altKey);
        snapFeedback.update(snappedPoint?.snapSignature ?? null);
        break;
    }
  };

  const finishDrag = (cancelled: boolean): void => {
    pointerSession.finish();
    if (cancelled) previousTap = null;
    pointerDownEvent = null;
    if (!dragTarget) {
      return;
    }
    const completedDrag = dragTarget;
    const mergeTargetId = cancelled ? null : pendingMergeTargetId;
    dragTarget = null;
    pendingMergeTargetId = null;
    alignmentGuides = { x: null, y: null };
    if (completedDrag.kind === 'marquee') {
      if (!pointerDidMove && !cancelled) {
        clearEditorFocus(true);
        editorEl?.blur();
      }
    } else if (pointerDidMove && completedDrag.kind === 'anchor' && mergeTargetId) {
      const draggedIndex = localAnchors.findIndex(
        (anchor) => anchor.id === completedDrag.anchorId,
      );
      const targetIndex = localAnchors.findIndex((anchor) => anchor.id === mergeTargetId);
      const mergesOpenEndpoints = !localClosed
        && localAnchors.length >= 3
        && (
          draggedIndex === 0 && targetIndex === localAnchors.length - 1
          || targetIndex === 0 && draggedIndex === localAnchors.length - 1
      );
      if (mergesOpenEndpoints) {
        mergeAnchors(completedDrag.anchorId, mergeTargetId, true);
      } else {
        mergeAnchors(completedDrag.anchorId, mergeTargetId, false);
      }
    } else if (pointerDidMove) {
      emitGeometry(localAnchors, localClosed, true);
    }
    pointerDidMove = false;
    snapFeedback.reset();
  };

  const handlePointerUp = (event: PointerEvent): void => {
    previousTap = pointerDownEvent && !pointerDidMove
      && event.timeStamp - pointerDownEvent.timeStamp <= TAP_WINDOW_MS
      && !isRepeatedPress(pointerDownEvent) ? pointerDownEvent : null;
    finishDrag(false);
  };
  const handleWindowPointerDown = (event: PointerEvent): void => {
    if (input.readonly || !editorEl) {
      return;
    }
    const target = event.target;
    if (target instanceof Node && editorEl.contains(target)) {
      return;
    }
    finishDrag(true);
    clearEditorFocus();
    editorEl.blur();
  };

  $effect(() => pointerSession.listen({
    move: handlePointerMove,
    up: handlePointerUp,
    cancel: () => finishDrag(true),
    outsidePress: handleWindowPointerDown,
  }));
  return {
    view,
    get element() { return editorEl; },
    set element(element: HTMLDivElement | null) { editorEl = element; },
    get anchors() { return localAnchors; },
    get closed() { return localClosed; },
    get drawingEndpoint() { return drawingEndpoint; },
    handleSurfacePointerDown,
    handleSurfaceDoubleClick,
    handleEditorKeyDown,
    beginPathMove,
    handleSegmentDoubleClick,
    handleBezierHandlePointerDown,
    beginPathRotation,
    beginPathScale,
    handleAnchorPointerDown,
    handleAnchorDoubleClick,
  };
};
