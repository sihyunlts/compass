<svelte:options runes={true} />

<script lang="ts">
  import type { RendererControlChange } from '../../../devices/control-types';
  import {
    PATH_COORDINATE_MAX,
    PATH_COORDINATE_MIN,
    IDENTITY_PATH_TRANSFORM,
    createPathAnchorId,
    sanitizePathAnchors,
    sanitizePathTransform,
  } from '../../../devices/path/schema';
  import {
    collectPathControlPoints,
    evaluateCubicBezier,
    resolveAbsolutePathHandle,
    sampleAnimatedPathAtProgress,
  } from '../../../core/generators/path';
  import {
    applyAffine,
    composeAffine,
    invertAffine,
    toRotateTransformAt,
    toTranslationTransform,
  } from '../../../core/geometry';
  import { clamp } from '../../../shared/math';
  import {
    clonePathAnchors,
    type PathAnchor,
    type PathTransform,
  } from '../../../shared/model';
  import { i18n } from '../../i18n.svelte';
  import ControlSurfaceFrame from './ControlSurfaceFrame.svelte';
  import {
    CONTROL_POINT_DRAG_THRESHOLD_PX,
    CONTROL_POINT_SOFT_SNAP_DISTANCE_PX,
    hasExceededControlPointDragThreshold,
    toSoftSnappedValue,
  } from './control-point-editor';

  type EditorPoint = { x: number; y: number };
  type PathBounds = { minX: number; minY: number; maxX: number; maxY: number };
  type AlignmentGuides = { x: number | null; y: number | null };
  type AxisSnap = { value: number; target: number | null };
  type RotationFeedbackPosition = {
    x: number;
    y: number;
    placement: 'above' | 'below';
  };
  type HandleKind = 'handleIn' | 'handleOut';
  type Selection =
    | { kind: 'anchors'; anchorIds: string[] }
    | { kind: 'path' }
    | null;
  type DragTarget =
    | { kind: 'anchor'; anchorId: string }
    | { kind: 'anchor-handle'; anchorId: string }
    | { kind: 'handle'; anchorId: string; handleKind: HandleKind }
    | {
      kind: 'anchors-move';
      anchorIds: string[];
      startPoint: EditorPoint;
      startAnchors: PathAnchor[];
    }
    | {
      kind: 'path-move';
      startPoint: EditorPoint;
      startTransform: PathTransform;
      startBounds: PathBounds;
    }
    | {
      kind: 'path-rotate';
      center: EditorPoint;
      startAngle: number;
      startRotationRadians: number;
      startTransform: PathTransform;
      feedbackPosition: RotationFeedbackPosition;
    }
    | {
      kind: 'path-scale';
      fixedPoint: EditorPoint;
      startVector: EditorPoint;
      startTransform: PathTransform;
      pointerOffset: EditorPoint;
    }
    | {
      kind: 'marquee';
      startPoint: EditorPoint;
      currentPoint: EditorPoint;
      additiveAnchorIds: string[];
    }
    | null;

  let {
    deviceId,
    anchors = [] as PathAnchor[],
    closed = false,
    fill = false,
    transform = IDENTITY_PATH_TRANSFORM,
    readonly = false,
    previewProgress01 = null,
    previewDirection = 'forward',
    previewStartAnchorId = '',
    selectedAnchorId = null,
    onAnchorSelect,
    onControlChange,
  } = $props<{
    deviceId: string;
    anchors: PathAnchor[];
    closed: boolean;
    fill?: boolean;
    transform?: PathTransform;
    readonly?: boolean;
    previewProgress01?: number | null;
    previewDirection?: 'forward' | 'reverse';
    previewStartAnchorId?: string;
    selectedAnchorId?: string | null;
    onAnchorSelect?: (anchorId: string) => void;
    onControlChange: (change: RendererControlChange) => void;
  }>();

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
  let rotationFeedback = $state<{
    degrees: number;
    snapped: boolean;
  } | null>(null);

  const COORDINATE_RANGE = PATH_COORDINATE_MAX - PATH_COORDINATE_MIN;
  const EDITOR_CENTER = PATH_COORDINATE_MIN + COORDINATE_RANGE / 2;
  const PATH_TRANSFORM_SNAP_DISTANCE_PX = 4;
  const SOFT_ROTATION_SNAP_RADIANS = Math.PI / 4;
  const MAX_SOFT_ROTATION_DISTANCE_RADIANS = Math.PI / 60;
  const LOCKED_ROTATION_SNAP_RADIANS = Math.PI / 12;
  const ROTATION_ZONE_SIZE_PERCENT = 8;
  const TRANSFORM_HANDLE_INSET_PERCENT = 3;
  const MIN_PATH_SCALE_SIZE_PX = 1;
  const SNAP_VALUES = Array.from(
    { length: (COORDINATE_RANGE * 2) + 1 },
    (_, index) => PATH_COORDINATE_MIN + index * 0.5,
  );
  const GRID_POSITIONS = Array.from(
    { length: COORDINATE_RANGE + 1 },
    (_, index) => PATH_COORDINATE_MIN + index,
  );
  const SCALE_SNAP_VALUES = [...GRID_POSITIONS, EDITOR_CENTER];

  const roundCoordinate = (value: number): number => Number(value.toFixed(3));

  const toWorldPoint = (
    point: Readonly<EditorPoint>,
    pathTransform: Readonly<PathTransform> = localTransform,
  ): EditorPoint => applyAffine(pathTransform, point);

  const toLocalPoint = (
    point: Readonly<EditorPoint>,
    pathTransform: Readonly<PathTransform> = localTransform,
  ): EditorPoint | null => {
    const inverse = invertAffine(pathTransform);
    return inverse ? applyAffine(inverse, point) : null;
  };

  const toSignedScaleTransformAt = (
    scaleX: number,
    scaleY: number,
    center: Readonly<EditorPoint>,
  ): PathTransform | null => {
    if (
      !Number.isFinite(scaleX)
      || !Number.isFinite(scaleY)
      || !Number.isFinite(center.x)
      || !Number.isFinite(center.y)
      || Math.abs(scaleX) < Number.EPSILON
      || Math.abs(scaleY) < Number.EPSILON
    ) {
      return null;
    }
    return {
      a: scaleX,
      b: 0,
      c: 0,
      d: scaleY,
      tx: center.x - center.x * scaleX,
      ty: center.y - center.y * scaleY,
    };
  };

  const resolveSignedMinimumScale = (
    scale: number,
    minimumMagnitude: number,
  ): number => {
    if (Math.abs(scale) >= minimumMagnitude) {
      return scale;
    }
    return (scale < 0 ? -1 : 1) * minimumMagnitude;
  };

  const resolveTransformedVectorLengthPx = (
    pathTransform: Readonly<PathTransform>,
    vector: Readonly<EditorPoint>,
    rect: DOMRect | undefined,
  ): number => {
    if (!rect) {
      return 0;
    }
    const worldVector = {
      x: pathTransform.a * vector.x + pathTransform.b * vector.y,
      y: pathTransform.c * vector.x + pathTransform.d * vector.y,
    };
    return Math.hypot(
      worldVector.x * rect.width / COORDINATE_RANGE,
      worldVector.y * rect.height / COORDINATE_RANGE,
    );
  };

  const resolveTransformAxisSnap = (
    value: number,
    targets: readonly number[],
    spanPx: number,
    enabled: boolean,
  ): AxisSnap => {
    if (!enabled || !Number.isFinite(spanPx) || spanPx <= 0) {
      return { value, target: null };
    }
    let nearestTarget: number | null = null;
    let nearestDistancePx = Number.POSITIVE_INFINITY;
    for (const target of targets) {
      const distancePx = Math.abs(value - target) * spanPx / COORDINATE_RANGE;
      if (
        distancePx <= PATH_TRANSFORM_SNAP_DISTANCE_PX
        && distancePx < nearestDistancePx
      ) {
        nearestTarget = target;
        nearestDistancePx = distancePx;
      }
    }
    return nearestTarget === null
      ? { value, target: null }
      : { value: nearestTarget, target: nearestTarget };
  };

  const resolveTranslatedAxisSnap = (
    delta: number,
    sources: readonly number[],
    targets: readonly number[],
    spanPx: number,
    enabled: boolean,
  ): AxisSnap => {
    if (
      !enabled
      || sources.length === 0
      || targets.length === 0
      || !Number.isFinite(spanPx)
      || spanPx <= 0
    ) {
      return { value: delta, target: null };
    }
    let snappedDelta = delta;
    let nearestTarget: number | null = null;
    let nearestDistancePx = Number.POSITIVE_INFINITY;
    for (const source of sources) {
      const translated = source + delta;
      for (const target of targets) {
        const distancePx = Math.abs(translated - target) * spanPx / COORDINATE_RANGE;
        if (
          distancePx <= PATH_TRANSFORM_SNAP_DISTANCE_PX
          && distancePx < nearestDistancePx
        ) {
          snappedDelta = delta + target - translated;
          nearestTarget = target;
          nearestDistancePx = distancePx;
        }
      }
    }
    return { value: snappedDelta, target: nearestTarget };
  };

  const resolveTranslationDelta = (
    startPoint: EditorPoint,
    point: EditorPoint,
    lockAxis: boolean,
  ): EditorPoint => {
    const delta = {
      x: point.x - startPoint.x,
      y: point.y - startPoint.y,
    };
    if (!lockAxis) {
      return delta;
    }
    return Math.abs(delta.x) >= Math.abs(delta.y)
      ? { x: delta.x, y: 0 }
      : { x: 0, y: delta.y };
  };

  const resolveEditorPointFromClient = (
    clientX: number,
    clientY: number,
    softSnap: boolean,
    constrainToEditor = true,
  ): EditorPoint | null => {
    if (!editorEl) {
      return null;
    }
    const rect = editorEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const rawRatioX = (clientX - rect.left) / rect.width;
    const rawRatioY = (clientY - rect.top) / rect.height;
    const ratioX = constrainToEditor ? clamp(rawRatioX, 0, 1) : rawRatioX;
    const ratioY = constrainToEditor ? clamp(rawRatioY, 0, 1) : rawRatioY;
    const rawX = PATH_COORDINATE_MIN + ratioX * COORDINATE_RANGE;
    const rawY = PATH_COORDINATE_MAX - ratioY * COORDINATE_RANGE;
    return {
      x: roundCoordinate(softSnap
        ? toSoftSnappedValue(rawX, SNAP_VALUES, rect.width / COORDINATE_RANGE)
        : rawX),
      y: roundCoordinate(softSnap
        ? toSoftSnappedValue(rawY, SNAP_VALUES, rect.height / COORDINATE_RANGE)
        : rawY),
    };
  };

  const resolveLocalEditorPoint = (
    clientX: number,
    clientY: number,
    softSnap: boolean,
  ): EditorPoint | null => {
    const worldPoint = resolveEditorPointFromClient(clientX, clientY, softSnap);
    const localPoint = worldPoint ? toLocalPoint(worldPoint) : null;
    return localPoint
      ? { x: roundCoordinate(localPoint.x), y: roundCoordinate(localPoint.y) }
      : null;
  };

  const resolveEditorPoint = (clientX: number, clientY: number): EditorPoint | null =>
    resolveLocalEditorPoint(clientX, clientY, true);

  const resolveUnsnappedEditorPoint = (
    clientX: number,
    clientY: number,
  ): EditorPoint | null => resolveEditorPointFromClient(clientX, clientY, false);

  const resolveUnboundedEditorPoint = (
    clientX: number,
    clientY: number,
  ): EditorPoint | null => resolveEditorPointFromClient(clientX, clientY, false, false);

  const toPlotPoint = (point: EditorPoint): EditorPoint => ({
    x: roundCoordinate(((point.x - PATH_COORDINATE_MIN) / COORDINATE_RANGE) * 100),
    y: roundCoordinate((1 - ((point.y - PATH_COORDINATE_MIN) / COORDINATE_RANGE)) * 100),
  });

  const resolvePathBounds = (
    pathAnchors: readonly PathAnchor[],
  ): PathBounds | null => {
    const points = collectPathControlPoints(pathAnchors);
    if (points.length === 0) {
      return null;
    }
    return {
      minX: Math.min(...points.map((point) => point.x)),
      minY: Math.min(...points.map((point) => point.y)),
      maxX: Math.max(...points.map((point) => point.x)),
      maxY: Math.max(...points.map((point) => point.y)),
    };
  };

  const resolveWorldPathBounds = (
    pathAnchors: readonly PathAnchor[],
    pathTransform: Readonly<PathTransform>,
  ): PathBounds | null => {
    const bounds = resolvePathBounds(pathAnchors);
    if (!bounds) {
      return null;
    }
    const points = [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.minX, y: bounds.maxY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
    ].map((point) => toWorldPoint(point, pathTransform));
    return {
      minX: Math.min(...points.map((point) => point.x)),
      minY: Math.min(...points.map((point) => point.y)),
      maxX: Math.max(...points.map((point) => point.x)),
      maxY: Math.max(...points.map((point) => point.y)),
    };
  };

  const buildSegmentPath = (start: PathAnchor, end: PathAnchor): string => {
    const startPlot = toPlotPoint(toWorldPoint(start));
    const endPlot = toPlotPoint(toWorldPoint(end));
    if (!start.handleOut && !end.handleIn) {
      return `M ${startPlot.x} ${startPlot.y} L ${endPlot.x} ${endPlot.y}`;
    }
    const control1 = toPlotPoint(toWorldPoint(
      resolveAbsolutePathHandle(start, start.handleOut),
    ));
    const control2 = toPlotPoint(toWorldPoint(
      resolveAbsolutePathHandle(end, end.handleIn),
    ));
    return `M ${startPlot.x} ${startPlot.y} C ${control1.x} ${control1.y} ${control2.x} ${control2.y} ${endPlot.x} ${endPlot.y}`;
  };

  const segments = $derived.by(() => {
    const result: Array<{ index: number; d: string }> = [];
    for (let index = 0; index < localAnchors.length - 1; index += 1) {
      result.push({
        index,
        d: buildSegmentPath(localAnchors[index], localAnchors[index + 1]),
      });
    }
    if (localClosed && localAnchors.length > 1) {
      const index = localAnchors.length - 1;
      result.push({
        index,
        d: buildSegmentPath(localAnchors[index], localAnchors[0]),
      });
    }
    return result;
  });

  const combinedPath = $derived(segments.map((segment, index) => (
    index === 0 ? segment.d : segment.d.replace(/^M \S+ \S+ /, '')
  )).join(' '));
  const plottedAnchors = $derived(localAnchors.map((anchor, index) => ({
    ...toPlotPoint(toWorldPoint(anchor)),
    id: anchor.id,
    index,
    mergeTarget: pendingMergeTargetId === anchor.id,
    selected: readonly
      ? selectedAnchorId === anchor.id
      : selection?.kind === 'anchors' && selection.anchorIds.includes(anchor.id),
  })));
  const selectedAnchor = $derived.by(() => {
    if (selection?.kind !== 'anchors' || selection.anchorIds.length !== 1) {
      return null;
    }
    const anchorId = selection.anchorIds[0];
    const index = localAnchors.findIndex((anchor) => anchor.id === anchorId);
    return index >= 0 ? { anchor: localAnchors[index], index } : null;
  });
  const selectedHandles = $derived.by(() => {
    if (!selectedAnchor || readonly) {
      return [];
    }
    const anchorPlot = toPlotPoint(toWorldPoint(selectedAnchor.anchor));
    return (['handleIn', 'handleOut'] as const).flatMap((kind) => {
      const handle = selectedAnchor.anchor[kind];
      if (!handle) {
        return [];
      }
      const point = resolveAbsolutePathHandle(selectedAnchor.anchor, handle);
      const plotted = toPlotPoint(toWorldPoint(point));
      return [{
        kind,
        x: plotted.x,
        y: plotted.y,
        anchorX: anchorPlot.x,
        anchorY: anchorPlot.y,
      }];
    });
  });
  const pathSelection = $derived.by(() => {
    if (readonly || selection?.kind !== 'path') {
      return null;
    }
    const bounds = resolvePathBounds(localAnchors);
    if (!bounds) {
      return null;
    }
    const localCenter = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };
    const center = toWorldPoint(localCenter);
    const centerPlot = toPlotPoint(center);
    const isHorizontal = Math.abs(bounds.maxY - bounds.minY) <= Number.EPSILON;
    const isVertical = Math.abs(bounds.maxX - bounds.minX) <= Number.EPSILON;
    const scaleHandleCandidates = [
      {
        id: 'north-west',
        point: { x: bounds.minX, y: bounds.maxY },
        fixedPoint: { x: bounds.maxX, y: bounds.minY },
        cursor: isHorizontal ? 'ew-resize' : isVertical ? 'ns-resize' : 'nwse-resize',
      },
      {
        id: 'north-east',
        point: { x: bounds.maxX, y: bounds.maxY },
        fixedPoint: { x: bounds.minX, y: bounds.minY },
        cursor: isHorizontal ? 'ew-resize' : isVertical ? 'ns-resize' : 'nesw-resize',
      },
      {
        id: 'south-east',
        point: { x: bounds.maxX, y: bounds.minY },
        fixedPoint: { x: bounds.minX, y: bounds.maxY },
        cursor: isHorizontal ? 'ew-resize' : isVertical ? 'ns-resize' : 'nwse-resize',
      },
      {
        id: 'south-west',
        point: { x: bounds.minX, y: bounds.minY },
        fixedPoint: { x: bounds.maxX, y: bounds.maxY },
        cursor: isHorizontal ? 'ew-resize' : isVertical ? 'ns-resize' : 'nesw-resize',
      },
    ];
    const scaleHandlePositions: string[] = [];
    const scaleHandles = scaleHandleCandidates.flatMap((handle) => {
      const vector = {
        x: handle.point.x - handle.fixedPoint.x,
        y: handle.point.y - handle.fixedPoint.y,
      };
      if (Math.hypot(vector.x, vector.y) <= Number.EPSILON) {
        return [];
      }
      const worldPoint = toWorldPoint(handle.point);
      const worldFixedPoint = toWorldPoint(handle.fixedPoint);
      const actualPlot = toPlotPoint(worldPoint);
      const plot = {
        x: clamp(
          actualPlot.x,
          TRANSFORM_HANDLE_INSET_PERCENT,
          100 - TRANSFORM_HANDLE_INSET_PERCENT,
        ),
        y: clamp(
          actualPlot.y,
          TRANSFORM_HANDLE_INSET_PERCENT,
          100 - TRANSFORM_HANDLE_INSET_PERCENT,
        ),
      };
      const fixedPlot = toPlotPoint(worldFixedPoint);
      const positionKey = `${plot.x}:${plot.y}`;
      if (scaleHandlePositions.includes(positionKey)) {
        return [];
      }
      scaleHandlePositions.push(positionKey);
      const rotationPosition = `${plot.y < centerPlot.y ? 'north' : 'south'}-${
        plot.x < centerPlot.x ? 'west' : 'east'
      }` as 'north-west' | 'north-east' | 'south-east' | 'south-west';
      const rotationZoneInside = rotationPosition === 'north-west'
        ? plot.x < ROTATION_ZONE_SIZE_PERCENT || plot.y < ROTATION_ZONE_SIZE_PERCENT
        : rotationPosition === 'north-east'
          ? 100 - plot.x < ROTATION_ZONE_SIZE_PERCENT || plot.y < ROTATION_ZONE_SIZE_PERCENT
          : rotationPosition === 'south-east'
            ? 100 - plot.x < ROTATION_ZONE_SIZE_PERCENT
              || 100 - plot.y < ROTATION_ZONE_SIZE_PERCENT
            : plot.x < ROTATION_ZONE_SIZE_PERCENT
              || 100 - plot.y < ROTATION_ZONE_SIZE_PERCENT;
      return [{
        ...handle,
        x: plot.x,
        y: plot.y,
        cursor: isHorizontal
          ? 'ew-resize'
          : isVertical
            ? 'ns-resize'
            : Math.sign(plot.x - fixedPlot.x) === Math.sign(plot.y - fixedPlot.y)
              ? 'nwse-resize'
              : 'nesw-resize',
        rotationPosition,
        rotationZoneInside,
      }];
    });
    const localCorners = [
      { x: bounds.minX, y: bounds.maxY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.minX, y: bounds.minY },
    ];
    const worldCorners = localCorners.map((point) => toWorldPoint(point));
    const plottedCorners = worldCorners.map((point) => toPlotPoint(point));
    const worldBounds = {
      minX: Math.min(...worldCorners.map((point) => point.x)),
      minY: Math.min(...worldCorners.map((point) => point.y)),
      maxX: Math.max(...worldCorners.map((point) => point.x)),
      maxY: Math.max(...worldCorners.map((point) => point.y)),
    };
    const topLeft = toPlotPoint({ x: worldBounds.minX, y: worldBounds.maxY });
    const bottomRight = toPlotPoint({ x: worldBounds.maxX, y: worldBounds.minY });
    return {
      center,
      localCenter,
      localBounds: bounds,
      polygon: plottedCorners.map((point) => `${point.x},${point.y}`).join(' '),
      left: topLeft.x,
      top: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
      scaleHandles,
    };
  });
  const rotationFeedbackPosition = $derived(
    rotationFeedback && dragTarget?.kind === 'path-rotate'
      ? dragTarget.feedbackPosition
      : null,
  );

  const resolveRotationFeedbackPosition = (
    selectionBounds: NonNullable<typeof pathSelection>,
  ): RotationFeedbackPosition => {
    const center = toPlotPoint(selectionBounds.center);
    const radius = Math.hypot(
      selectionBounds.width / 2,
      selectionBounds.height / 2,
    );
    const aboveY = center.y - radius;
    const belowY = center.y + radius;
    if (aboveY >= 10) {
      return {
        x: clamp(center.x, 12, 88),
        y: clamp(aboveY, 8, 92),
        placement: 'above',
      };
    }
    if (belowY <= 90) {
      return {
        x: clamp(center.x, 12, 88),
        y: clamp(belowY, 8, 92),
        placement: 'below',
      };
    }
    return {
      x: clamp(center.x, 12, 88),
      y: 8,
      placement: 'below',
    };
  };
  const marqueeBox = $derived.by(() => {
    if (dragTarget?.kind !== 'marquee' || !pointerDidMove) {
      return null;
    }
    const start = toPlotPoint(dragTarget.startPoint);
    const current = toPlotPoint(dragTarget.currentPoint);
    return {
      left: Math.min(start.x, current.x),
      top: Math.min(start.y, current.y),
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y),
    };
  });
  const gridLineOffsets = $derived(GRID_POSITIONS.map((position) => toPlotPoint({ x: position, y: position }).x));
  const plottedAlignmentGuides = $derived({
    x: alignmentGuides.x === null
      ? null
      : toPlotPoint({ x: alignmentGuides.x, y: PATH_COORDINATE_MIN }).x,
    y: alignmentGuides.y === null
      ? null
      : toPlotPoint({ x: PATH_COORDINATE_MIN, y: alignmentGuides.y }).y,
  });
  const previewPoint = $derived.by(() => {
    if (previewProgress01 === null || localAnchors.length < 2) {
      return null;
    }
    const point = sampleAnimatedPathAtProgress(
      localAnchors,
      localClosed,
      previewStartAnchorId,
      previewDirection,
      clamp(previewProgress01, 0, 1),
      localTransform,
    );
    return point ? toPlotPoint(point) : null;
  });

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
    onControlChange({
      action: 'set-path-geometry',
      deviceId,
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
      if (isPointNearAnchor(point, anchor, CONTROL_POINT_DRAG_THRESHOLD_PX)) {
        const next = { ...anchor };
        delete next[kind];
        if (!independent) {
          const opposite: HandleKind = kind === 'handleIn' ? 'handleOut' : 'handleIn';
          delete next[opposite];
        }
        return next;
      }
      const rawHandle = {
        x: roundCoordinate(point.x - anchor.x),
        y: roundCoordinate(point.y - anchor.y),
      };
      if (independent) {
        return {
          ...anchor,
          [kind]: rawHandle,
        };
      }
      const handle = rawHandle;
      const opposite: HandleKind = kind === 'handleIn' ? 'handleOut' : 'handleIn';
      return {
        ...anchor,
        [kind]: handle,
        [opposite]: { x: -handle.x, y: -handle.y },
      };
    }, false);
  };

  const resolveDraggedHandleKind = (
    anchorId: string,
    point: EditorPoint,
  ): HandleKind => {
    const index = localAnchors.findIndex((anchor) => anchor.id === anchorId);
    const anchor = localAnchors[index];
    if (!anchor) {
      return 'handleOut';
    }
    const previous = localAnchors[index - 1]
      ?? (localClosed ? localAnchors.at(-1) : undefined);
    const next = localAnchors[index + 1]
      ?? (localClosed ? localAnchors[0] : undefined);
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
    const draggedIndex = localAnchors.findIndex((anchor) => anchor.id === draggedAnchorId);
    const targetIndex = localAnchors.findIndex((anchor) => anchor.id === targetAnchorId);
    const dragged = localAnchors[draggedIndex];
    const target = localAnchors[targetIndex];
    if (!dragged || !target || draggedIndex === targetIndex) {
      return;
    }

    const draggedBeforeTarget = targetIndex === draggedIndex + 1
      || (localClosed && draggedIndex === localAnchors.length - 1 && targetIndex === 0);
    const targetBeforeDragged = draggedIndex === targetIndex + 1
      || (localClosed && targetIndex === localAnchors.length - 1 && draggedIndex === 0);
    if (!closePath && !draggedBeforeTarget && !targetBeforeDragged) {
      return;
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
    const next = localAnchors
      .filter((anchor) => anchor.id !== draggedAnchorId)
      .map((anchor) => anchor.id === targetAnchorId ? mergedTarget : anchor);
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

  const movePath = (
    startTransform: Readonly<PathTransform>,
    bounds: PathBounds,
    startPoint: EditorPoint,
    point: EditorPoint,
    lockAxis: boolean,
    snapEnabled: boolean,
  ): void => {
    const rect = editorEl?.getBoundingClientRect();
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
    alignmentGuides = {
      x: appliesSnapX ? (usesCenterX ? EDITOR_CENTER : snappedEdgesX.target) : null,
      y: appliesSnapY ? (usesCenterY ? EDITOR_CENTER : snappedEdgesY.target) : null,
    };
    rotationFeedback = null;
    emitGeometry(
      localAnchors,
      localClosed,
      false,
      composeAffine(
        toTranslationTransform(deltaX, deltaY),
        startTransform,
      ),
    );
  };

  const moveSelectedAnchors = (
    startAnchors: readonly PathAnchor[],
    anchorIds: readonly string[],
    startPoint: EditorPoint,
    point: EditorPoint,
    lockAxis: boolean,
    snapEnabled: boolean,
  ): void => {
    const selectedIds = new Set(anchorIds);
    const selectedAnchors = startAnchors.filter((anchor) => selectedIds.has(anchor.id));
    const unselectedAnchors = startAnchors.filter((anchor) => !selectedIds.has(anchor.id));
    if (selectedAnchors.length === 0) {
      return;
    }
    const rect = editorEl?.getBoundingClientRect();
    const rawDelta = resolveTranslationDelta(startPoint, point, lockAxis);
    const snappedDeltaX = resolveTranslatedAxisSnap(
      rawDelta.x,
      selectedAnchors.map((anchor) => toWorldPoint(anchor).x),
      unselectedAnchors.map((anchor) => toWorldPoint(anchor).x),
      rect?.width ?? 0,
      snapEnabled && (!lockAxis || rawDelta.x !== 0),
    );
    const snappedDeltaY = resolveTranslatedAxisSnap(
      rawDelta.y,
      selectedAnchors.map((anchor) => toWorldPoint(anchor).y),
      unselectedAnchors.map((anchor) => toWorldPoint(anchor).y),
      rect?.height ?? 0,
      snapEnabled && (!lockAxis || rawDelta.y !== 0),
    );
    const inverse = invertAffine(localTransform);
    if (!inverse) {
      return;
    }
    const requestedLocalDelta = {
      x: inverse.a * snappedDeltaX.value + inverse.b * snappedDeltaY.value,
      y: inverse.c * snappedDeltaX.value + inverse.d * snappedDeltaY.value,
    };
    const deltaX = requestedLocalDelta.x;
    const deltaY = requestedLocalDelta.y;
    alignmentGuides = {
      x: Math.abs(deltaX - requestedLocalDelta.x) <= Number.EPSILON
        ? snappedDeltaX.target
        : null,
      y: Math.abs(deltaY - requestedLocalDelta.y) <= Number.EPSILON
        ? snappedDeltaY.target
        : null,
    };
    rotationFeedback = null;
    emitGeometry(startAnchors.map((anchor) => selectedIds.has(anchor.id)
      ? {
        ...anchor,
        x: roundCoordinate(anchor.x + deltaX),
        y: roundCoordinate(anchor.y + deltaY),
      }
      : anchor), localClosed, false);
  };

  const rotatePath = (
    startTransform: Readonly<PathTransform>,
    center: EditorPoint,
    angle: number,
    startRotationRadians: number,
    point: EditorPoint,
    lockToIncrement: boolean,
    snapEnabled: boolean,
  ): void => {
    const requestedRotation = startRotationRadians + angle;
    let resolvedRotation = requestedRotation;
    let snapped = false;
    if (lockToIncrement) {
      resolvedRotation = Math.round(requestedRotation / LOCKED_ROTATION_SNAP_RADIANS)
        * LOCKED_ROTATION_SNAP_RADIANS;
      snapped = true;
    } else if (snapEnabled) {
      const rect = editorEl?.getBoundingClientRect();
      if (rect) {
        const radiusPx = Math.hypot(
          (point.x - center.x) * rect.width / COORDINATE_RANGE,
          (point.y - center.y) * rect.height / COORDINATE_RANGE,
        );
        const candidate = Math.round(requestedRotation / SOFT_ROTATION_SNAP_RADIANS)
          * SOFT_ROTATION_SNAP_RADIANS;
        const angularDistance = Math.abs(requestedRotation - candidate);
        if (
          angularDistance <= MAX_SOFT_ROTATION_DISTANCE_RADIANS
          && angularDistance * radiusPx <= PATH_TRANSFORM_SNAP_DISTANCE_PX
        ) {
          resolvedRotation = candidate;
          snapped = true;
        }
      }
    }
    const rawDegrees = resolvedRotation * 180 / Math.PI;
    const resolvedRotationDegrees = ((rawDegrees + 180) % 360 + 360) % 360 - 180;
    const resolvedAngle = resolvedRotation - startRotationRadians;
    alignmentGuides = { x: null, y: null };
    rotationFeedback = {
      degrees: Math.round(resolvedRotationDegrees),
      snapped,
    };
    emitGeometry(
      localAnchors,
      localClosed,
      false,
      composeAffine(
        toRotateTransformAt(resolvedAngle * 180 / Math.PI, center),
        startTransform,
      ),
    );
  };

  const scalePath = (
    startTransform: Readonly<PathTransform>,
    fixedPoint: EditorPoint,
    startVector: EditorPoint,
    point: EditorPoint,
    lockAspectRatio: boolean,
    snapEnabled: boolean,
  ): void => {
    const hasX = Math.abs(startVector.x) > Number.EPSILON;
    const hasY = Math.abs(startVector.y) > Number.EPSILON;
    if (!hasX && !hasY) {
      return;
    }
    const inverse = invertAffine(startTransform);
    if (!inverse) {
      return;
    }
    const localPoint = applyAffine(inverse, point);
    const currentVector = {
      x: localPoint.x - fixedPoint.x,
      y: localPoint.y - fixedPoint.y,
    };
    const rect = editorEl?.getBoundingClientRect();
    const xVectorLengthPx = hasX
      ? resolveTransformedVectorLengthPx(
        startTransform,
        { x: startVector.x, y: 0 },
        rect,
      )
      : 0;
    const yVectorLengthPx = hasY
      ? resolveTransformedVectorLengthPx(
        startTransform,
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
        const worldFixedPoint = applyAffine(startTransform, fixedPoint);
        const worldStartPoint = applyAffine(startTransform, {
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
        } | null = null;
        const considerTarget = (targetScale: number): void => {
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
            nearest = { scale: targetScale, distancePx };
          }
        };
        if (Math.abs(worldVector.x) > Number.EPSILON) {
          for (const target of SCALE_SNAP_VALUES) {
            considerTarget((target - worldFixedPoint.x) / worldVector.x);
          }
        }
        if (Math.abs(worldVector.y) > Number.EPSILON) {
          for (const target of SCALE_SNAP_VALUES) {
            considerTarget((target - worldFixedPoint.y) / worldVector.y);
          }
        }
        if (nearest) {
          scale = nearest.scale;
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
    alignmentGuides = { x: null, y: null };
    rotationFeedback = null;
    const scaleTransform = toSignedScaleTransformAt(scaleX, scaleY, fixedPoint);
    if (!scaleTransform) {
      return;
    }
    emitGeometry(
      localAnchors,
      localClosed,
      false,
      composeAffine(startTransform, scaleTransform),
    );
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

  const resolveNearestSegmentSample = (
    start: PathAnchor,
    end: PathAnchor,
    point: EditorPoint,
  ): { t: number; distanceSquared: number } => {
    const p0 = { x: start.x, y: start.y };
    const p1 = resolveAbsolutePathHandle(start, start.handleOut);
    const p2 = resolveAbsolutePathHandle(end, end.handleIn);
    const p3 = { x: end.x, y: end.y };
    const worldPoint = toWorldPoint(point);
    let nearestT = 0.5;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;
    for (let step = 1; step < 64; step += 1) {
      const t = step / 64;
      const candidate = evaluateCubicBezier(p0, p1, p2, p3, t);
      const worldCandidate = toWorldPoint(candidate);
      const distanceSquared = (worldCandidate.x - worldPoint.x) ** 2
        + (worldCandidate.y - worldPoint.y) ** 2;
      if (distanceSquared < nearestDistanceSquared) {
        nearestT = t;
        nearestDistanceSquared = distanceSquared;
      }
    }
    return { t: nearestT, distanceSquared: nearestDistanceSquared };
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
      const { distanceSquared } = resolveNearestSegmentSample(start, end, point);
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

  const beginDrag = (event: MouseEvent, target: DragTarget): void => {
    if (readonly || event.button !== 0) {
      return;
    }
    editorEl?.focus({ preventScroll: true });
    dragTarget = target;
    pointerDownClientX = event.clientX;
    pointerDownClientY = event.clientY;
    pointerDidMove = false;
    pendingMergeTargetId = null;
    alignmentGuides = { x: null, y: null };
    rotationFeedback = null;
    event.preventDefault();
    event.stopPropagation();
  };

  const beginPathMove = (event: MouseEvent): void => {
    const startPoint = resolveUnboundedEditorPoint(event.clientX, event.clientY);
    const startBounds = resolveWorldPathBounds(localAnchors, localTransform);
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
    event: MouseEvent,
    anchorIds: string[],
  ): void => {
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

  const beginPathRotation = (event: MouseEvent): void => {
    if (!pathSelection) {
      return;
    }
    const point = resolveUnboundedEditorPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    beginDrag(event, {
      kind: 'path-rotate',
      center: pathSelection.center,
      startAngle: Math.atan2(
        point.y - pathSelection.center.y,
        point.x - pathSelection.center.x,
      ),
      startRotationRadians: Math.atan2(localTransform.c, localTransform.a),
      startTransform: { ...localTransform },
      feedbackPosition: resolveRotationFeedbackPosition(pathSelection),
    });
  };

  const beginPathScale = (
    event: MouseEvent,
    handle: { point: EditorPoint; fixedPoint: EditorPoint },
  ): void => {
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
    rotationFeedback = null;
    if (!preserveAppendEndpoint) {
      pendingAppendEndpoint = null;
    }
  };

  const handleSurfaceMouseDown = (event: MouseEvent): void => {
    if (readonly || event.button !== 0) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest('.path-editor-interactive')) {
      return;
    }
    const startPoint = resolveUnsnappedEditorPoint(event.clientX, event.clientY);
    if (!startPoint) {
      return;
    }
    if (event.detail === 1) {
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
    if (readonly || event.button !== 0) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest('.path-editor-interactive')) {
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

  const handleAnchorMouseDown = (event: MouseEvent, anchorId: string): void => {
    if (readonly) {
      return;
    }
    if (event.detail <= 1) {
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
    if (readonly || localClosed || localAnchors.length < 2) {
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

  const lerp = (start: EditorPoint, end: EditorPoint, t: number): EditorPoint => ({
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  });

  const insertAnchorInSegment = (segmentIndex: number, point: EditorPoint): void => {
    const startIndex = segmentIndex;
    const endIndex = segmentIndex === localAnchors.length - 1 ? 0 : segmentIndex + 1;
    const start = localAnchors[startIndex];
    const end = localAnchors[endIndex];
    if (!start || !end) {
      return;
    }
    const { t } = resolveNearestSegmentSample(start, end, point);
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
      const nextAnchors = clonePathAnchors(localAnchors);
      nextAnchors.splice(startIndex + 1, 0, inserted);
      emitGeometry(nextAnchors, localClosed, true);
      selection = { kind: 'anchors', anchorIds: [inserted.id] };
      drawingEndpoint = null;
      return;
    }
    const q0 = lerp(p0, p1, t);
    const q1 = lerp(p1, p2, t);
    const q2 = lerp(p2, p3, t);
    const r0 = lerp(q0, q1, t);
    const r1 = lerp(q1, q2, t);
    const split = lerp(r0, r1, t);
    const nextAnchors = clonePathAnchors(localAnchors);
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
    emitGeometry(nextAnchors, localClosed, true);
    selection = { kind: 'anchors', anchorIds: [inserted.id] };
    drawingEndpoint = null;
  };

  const handleSegmentDoubleClick = (event: MouseEvent, segmentIndex: number): void => {
    if (readonly) {
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
    if (readonly || !selection) {
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
    const selectedIds = new Set(selection.anchorIds);
    const selectedIndices = localAnchors.flatMap((anchor, index) =>
      selectedIds.has(anchor.id) ? [index] : []);
    if (selectedIndices.length === 0) {
      return;
    }
    const firstSelectedIndex = Math.min(...selectedIndices);
    const wasClosed = localClosed;
    const remaining = localAnchors.filter((anchor) => !selectedIds.has(anchor.id));
    const rotationIndex = remaining.length > 0 ? firstSelectedIndex % remaining.length : 0;
    const next = wasClosed
      ? [
        ...remaining.slice(rotationIndex),
        ...remaining.slice(0, rotationIndex),
      ]
      : remaining;
    emitGeometry(next, false, true);
    const selected = wasClosed
      ? next[0]
      : next[Math.min(firstSelectedIndex, next.length - 1)];
    selection = selected ? { kind: 'anchors', anchorIds: [selected.id] } : null;
    drawingEndpoint = wasClosed ? 'end' : null;
  };

  const handleEditorKeyDown = (event: KeyboardEvent): void => {
    if (readonly || event.defaultPrevented) {
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
    const nextAnchors = sanitizePathAnchors(anchors);
    localAnchors = nextAnchors;
    localClosed = closed;
    localTransform = nextAnchors.length > 0
      ? sanitizePathTransform(transform)
      : { ...IDENTITY_PATH_TRANSFORM };
    if (closed) {
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

  $effect(() => {
    const handleMouseMove = (event: MouseEvent): void => {
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
      const point = dragTarget.kind === 'path-move'
        || dragTarget.kind === 'path-rotate'
        || dragTarget.kind === 'path-scale'
        ? resolveUnboundedEditorPoint(event.clientX, event.clientY)
        : dragTarget.kind === 'anchors-move' || dragTarget.kind === 'marquee'
          ? resolveUnsnappedEditorPoint(event.clientX, event.clientY)
          : resolveEditorPoint(event.clientX, event.clientY);
      if (!point) {
        return;
      }
      if (!pointerDidMove) {
        return;
      }
      if (dragTarget.kind === 'marquee') {
        const marquee = dragTarget;
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
      } else if (dragTarget.kind === 'path-scale') {
        pendingMergeTargetId = null;
        const scalePoint = {
          x: point.x + dragTarget.pointerOffset.x,
          y: point.y + dragTarget.pointerOffset.y,
        };
        const scaleFixedPoint = event.altKey
          ? {
            x: dragTarget.fixedPoint.x + dragTarget.startVector.x / 2,
            y: dragTarget.fixedPoint.y + dragTarget.startVector.y / 2,
          }
          : dragTarget.fixedPoint;
        const scaleStartVector = event.altKey
          ? {
            x: dragTarget.startVector.x / 2,
            y: dragTarget.startVector.y / 2,
          }
          : dragTarget.startVector;
        scalePath(
          dragTarget.startTransform,
          scaleFixedPoint,
          scaleStartVector,
          scalePoint,
          event.shiftKey,
          !event.ctrlKey,
        );
      } else if (dragTarget.kind === 'anchors-move') {
        pendingMergeTargetId = null;
        moveSelectedAnchors(
          dragTarget.startAnchors,
          dragTarget.anchorIds,
          dragTarget.startPoint,
          point,
          event.shiftKey,
          !event.ctrlKey,
        );
      } else if (dragTarget.kind === 'path-move') {
        pendingMergeTargetId = null;
        movePath(
          dragTarget.startTransform,
          dragTarget.startBounds,
          dragTarget.startPoint,
          point,
          event.shiftKey,
          !event.ctrlKey,
        );
      } else if (dragTarget.kind === 'path-rotate') {
        pendingMergeTargetId = null;
        const angle = Math.atan2(
          point.y - dragTarget.center.y,
          point.x - dragTarget.center.x,
        ) - dragTarget.startAngle;
        rotatePath(
          dragTarget.startTransform,
          dragTarget.center,
          angle,
          dragTarget.startRotationRadians,
          point,
          event.shiftKey,
          !event.ctrlKey,
        );
      } else if (dragTarget.kind === 'anchor') {
        const mergeTarget = resolveMergeTarget(
          dragTarget.anchorId,
          event.clientX,
          event.clientY,
        );
        pendingMergeTargetId = mergeTarget?.id ?? null;
        moveAnchor(
          dragTarget.anchorId,
          mergeTarget ? { x: mergeTarget.x, y: mergeTarget.y } : point,
        );
      } else if (dragTarget.kind === 'anchor-handle') {
        pendingMergeTargetId = null;
        moveHandle(
          dragTarget.anchorId,
          resolveDraggedHandleKind(dragTarget.anchorId, point),
          point,
          false,
        );
      } else {
        pendingMergeTargetId = null;
        moveHandle(dragTarget.anchorId, dragTarget.handleKind, point, event.altKey);
      }
    };

    const handleMouseUp = (): void => {
      if (!dragTarget) {
        return;
      }
      const completedDrag = dragTarget;
      const mergeTargetId = pendingMergeTargetId;
      dragTarget = null;
      pendingMergeTargetId = null;
      alignmentGuides = { x: null, y: null };
      rotationFeedback = null;
      if (completedDrag.kind === 'marquee') {
        if (!pointerDidMove) {
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
    };

    const handleWindowPointerDown = (event: PointerEvent): void => {
      if (readonly || !editorEl) {
        return;
      }
      const target = event.target;
      if (target instanceof Node && editorEl.contains(target)) {
        return;
      }
      clearEditorFocus();
      editorEl.blur();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mouseleave', handleMouseUp);
    window.addEventListener('pointerdown', handleWindowPointerDown, { capture: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mouseleave', handleMouseUp);
      window.removeEventListener('pointerdown', handleWindowPointerDown, true);
    };
  });
</script>

<div class="path-editor-wrap">
  <ControlSurfaceFrame minSize="10rem">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="path-editor-surface"
      class:is-drawing={!readonly}
      bind:this={editorEl}
      tabindex="-1"
      onmousedown={handleSurfaceMouseDown}
      ondblclick={handleSurfaceDoubleClick}
      onkeydown={handleEditorKeyDown}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {#each gridLineOffsets as offset (`x:${offset}`)}
          <line class="path-editor-grid-line" x1={offset} y1="0" x2={offset} y2="100"></line>
        {/each}
        {#each gridLineOffsets as offset (`y:${offset}`)}
          <line class="path-editor-grid-line" x1="0" y1={offset} x2="100" y2={offset}></line>
        {/each}
        {#if plottedAlignmentGuides.x !== null}
          <line
            class="path-editor-alignment-guide"
            x1={plottedAlignmentGuides.x}
            y1="0"
            x2={plottedAlignmentGuides.x}
            y2="100"
          ></line>
        {/if}
        {#if plottedAlignmentGuides.y !== null}
          <line
            class="path-editor-alignment-guide"
            x1="0"
            y1={plottedAlignmentGuides.y}
            x2="100"
            y2={plottedAlignmentGuides.y}
          ></line>
        {/if}

        {#if combinedPath}
          <path class="path-editor-fill" class:is-visible={fill && localClosed} d={`${combinedPath} Z`}></path>
        {/if}
        {#each segments as segment (segment.index)}
          <path class="path-editor-line" d={segment.d}></path>
          {#if !readonly}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <path
              class="path-editor-hit-path path-editor-interactive"
              d={segment.d}
              onmousedown={beginPathMove}
              ondblclick={(event) => handleSegmentDoubleClick(event, segment.index)}
            ></path>
          {/if}
        {/each}
        {#if pathSelection}
          <polygon
            class="path-editor-selection-box"
            points={pathSelection.polygon}
          ></polygon>
        {/if}
        {#if marqueeBox}
          <rect
            class="path-editor-marquee"
            x={marqueeBox.left}
            y={marqueeBox.top}
            width={marqueeBox.width}
            height={marqueeBox.height}
          ></rect>
        {/if}
        {#each selectedHandles as handle (handle.kind)}
          <line
            class="path-editor-handle-line"
            x1={handle.anchorX}
            y1={handle.anchorY}
            x2={handle.x}
            y2={handle.y}
          ></line>
        {/each}
      </svg>

      {#each selectedHandles as handle (handle.kind)}
        <button
          type="button"
          class="path-editor-handle path-editor-interactive"
          style={`left:${handle.x}%;top:${handle.y}%;`}
          aria-label={i18n.t('control.pathHandle')}
          onmousedown={(event) => beginDrag(event, {
            kind: 'handle',
            anchorId: selectedAnchor?.anchor.id ?? '',
            handleKind: handle.kind,
          })}
        ></button>
      {/each}

      {#if pathSelection}
        {#each pathSelection.scaleHandles as handle (handle.id)}
          <button
            type="button"
            class={`path-editor-rotation-zone path-editor-interactive is-${handle.rotationPosition}`}
            class:is-inside={handle.rotationZoneInside}
            style={`left:${handle.x}%;top:${handle.y}%;`}
            aria-label={i18n.t('control.rotation')}
            onmousedown={beginPathRotation}
          ></button>
          <button
            type="button"
            class="path-editor-scale-handle path-editor-interactive"
            style={`left:${handle.x}%;top:${handle.y}%;cursor:${handle.cursor};`}
            aria-label={i18n.t('device.scale')}
            onmousedown={(event) => beginPathScale(event, handle)}
          ></button>
        {/each}
      {/if}
      {#if rotationFeedback && rotationFeedbackPosition}
        <span
          class="path-editor-transform-value"
          class:is-snapped={rotationFeedback.snapped}
          class:is-above={rotationFeedbackPosition.placement === 'above'}
          class:is-below={rotationFeedbackPosition.placement === 'below'}
          style={`left:${rotationFeedbackPosition.x}%;top:${rotationFeedbackPosition.y}%;`}
          aria-hidden="true"
        >{rotationFeedback.degrees}°</span>
      {/if}

      {#if !readonly || onAnchorSelect}
        {#each plottedAnchors as anchor (anchor.id)}
          <button
            type="button"
            class="path-editor-anchor path-editor-interactive"
            class:is-selected={anchor.selected}
            class:is-animation-start={readonly && selectedAnchorId === anchor.id}
            class:is-merge-target={anchor.mergeTarget}
            class:is-drawing-endpoint={drawingEndpoint === 'start' && anchor.index === 0 || drawingEndpoint === 'end' && anchor.index === localAnchors.length - 1}
            style={`left:${anchor.x}%;top:${anchor.y}%;`}
            aria-label={readonly && onAnchorSelect
              ? i18n.t('control.pathAnimationStartAnchor', { index: anchor.index + 1 })
              : i18n.t('control.pathAnchor', { index: anchor.index + 1 })}
            aria-pressed={readonly && onAnchorSelect
              ? selectedAnchorId === anchor.id
              : undefined}
            onmousedown={(event) => {
              if (!readonly) {
                handleAnchorMouseDown(event, anchor.id);
              }
            }}
            onclick={(event) => {
              if (readonly && onAnchorSelect) {
                event.stopPropagation();
                onAnchorSelect(anchor.id);
              }
            }}
            ondblclick={(event) => handleAnchorDoubleClick(event, anchor.id)}
          ></button>
        {/each}
      {/if}

      {#if previewPoint}
        <span
          class="path-editor-preview-point"
          style={`left:${previewPoint.x}%;top:${previewPoint.y}%;`}
          aria-hidden="true"
        ></span>
      {/if}
    </div>
  </ControlSurfaceFrame>
</div>

<style lang="scss">
  .path-editor-wrap {
    display: flex;
    align-items: stretch;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }

  .path-editor-surface {
    position: relative;
    aspect-ratio: 1 / 1;
    overflow: hidden;
    border: 1px solid var(--color-border-secondary);
    border-radius: var(--radius-6);
    background: var(--color-surface);
    cursor: default;

    &.is-drawing {
      cursor: crosshair;
    }

    svg {
      position: absolute;
      inset: 0;
      display: block;
      width: 100%;
      height: 100%;
    }
  }

  .path-editor-grid-line {
    stroke: var(--color-border-tertiary);
    stroke-width: 0.6;
    vector-effect: non-scaling-stroke;
  }

  .path-editor-alignment-guide {
    stroke: var(--device-control-accent, var(--color-surface-inverse));
    stroke-width: 1;
    pointer-events: none;
    vector-effect: non-scaling-stroke;
  }

  .path-editor-fill {
    fill: transparent;
    stroke: none;

    &.is-visible {
      fill: color-mix(in oklch, var(--device-control-accent, var(--color-surface-inverse)) 22%, transparent);
    }
  }

  .path-editor-line {
    fill: none;
    stroke: var(--device-control-accent, var(--color-surface-inverse));
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }

  .path-editor-hit-path {
    fill: none;
    stroke: transparent;
    stroke-width: 12;
    cursor: move;
    vector-effect: non-scaling-stroke;
  }

  .path-editor-selection-box,
  .path-editor-marquee {
    fill: none;
    stroke: var(--device-control-accent, var(--color-surface-inverse));
    stroke-width: 1;
    pointer-events: none;
    vector-effect: non-scaling-stroke;
  }

  .path-editor-selection-box {
    stroke-dasharray: 3 2;
  }

  .path-editor-marquee {
    fill: color-mix(in oklch, var(--device-control-accent, var(--color-surface-inverse)) 12%, transparent);
    stroke-dasharray: 2 1;
  }

  .path-editor-handle-line {
    stroke: var(--color-text-secondary);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }

  .path-editor-anchor,
  .path-editor-handle,
  .path-editor-scale-handle {
    position: absolute;
    transform: translate(-50%, -50%);
    border-radius: var(--radius-round);
  }

  .path-editor-anchor {
    width: 0.8rem;
    height: 0.8rem;
    padding: 0;
    border: 2px solid var(--color-surface);
    background: var(--color-surface-inverse);
    cursor: grab;

    &.is-selected,
    &.is-drawing-endpoint,
    &.is-merge-target,
    &.is-animation-start {
      background: var(--device-control-accent, var(--color-surface-inverse));
      box-shadow: 0 0 0 1px var(--color-text-primary);
    }

    &.is-animation-start {
      box-shadow: 0 0 0 2px var(--color-text-primary);
    }
  }

  .path-editor-handle {
    width: 0.62rem;
    height: 0.62rem;
    padding: 0;
    border: 1px solid var(--color-text-secondary);
    background: var(--color-surface-interactive);
    cursor: grab;
  }

  .path-editor-rotation-zone {
    position: absolute;
    z-index: 1;
    width: 8%;
    height: 8%;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;

    &.is-north-west {
      cursor: ne-resize;
      transform: translate(-100%, -100%);
    }

    &.is-north-east {
      cursor: se-resize;
      transform: translate(0, -100%);
    }

    &.is-south-east {
      cursor: sw-resize;
      transform: translate(0, 0);
    }

    &.is-south-west {
      cursor: nw-resize;
      transform: translate(-100%, 0);
    }

    &.is-north-west.is-inside {
      transform: translate(0, 0);
    }

    &.is-north-east.is-inside {
      transform: translate(-100%, 0);
    }

    &.is-south-east.is-inside {
      transform: translate(-100%, -100%);
    }

    &.is-south-west.is-inside {
      transform: translate(0, -100%);
    }
  }

  .path-editor-transform-value {
    position: absolute;
    z-index: 3;
    padding: 0.12rem 0.3rem;
    border: 1px solid var(--color-border-secondary);
    border-radius: var(--radius-4);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    font-size: 0.65rem;
    line-height: 1;
    pointer-events: none;

    &.is-above {
      transform: translate(-50%, -165%);
    }

    &.is-below {
      transform: translate(-50%, 65%);
    }

    &.is-snapped {
      border-color: var(--device-control-accent, var(--color-surface-inverse));
      color: var(--color-text-primary);
    }
  }

  .path-editor-scale-handle {
    z-index: 2;
    width: 0.58rem;
    height: 0.58rem;
    padding: 0;
    border: 1px solid var(--device-control-accent, var(--color-surface-inverse));
    border-radius: 0;
    background: var(--color-surface);
  }

  .path-editor-preview-point {
    position: absolute;
    width: 0.72rem;
    height: 0.72rem;
    border: 2px solid var(--color-surface);
    border-radius: var(--radius-2);
    background: var(--device-control-accent, var(--color-surface-inverse));
    pointer-events: none;
    transform: translate(-50%, -50%) rotate(45deg);
  }
</style>
