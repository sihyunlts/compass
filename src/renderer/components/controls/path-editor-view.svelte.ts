import { PATH_COORDINATE_MIN } from '../../../devices/path/schema';
import {
  resolveAbsolutePathHandle,
  resolvePathBounds,
  sampleAnimatedPathAtProgress,
} from '../../../core/generators/path';
import { toPathAffine } from '../../../core/path-transform';
import type { PathAnchor, PathTransform } from '../../../shared/model';
import { clamp } from '../../../shared/math';
import { resolveRotationCursor } from './rotation-interaction';
import {
  GRID_POSITIONS,
  ROTATION_ZONE_SIZE_PERCENT,
  TRANSFORM_HANDLE_INSET_PERCENT,
  toPlotPoint,
  toWorldPoint as transformPoint,
} from './path-editor-geometry';
import type { AlignmentGuides, DragTarget, EditorPoint, PathEditorInput, Selection } from './path-editor-types';

interface PathEditorViewState {
  readonly anchors: PathAnchor[];
  readonly closed: boolean;
  readonly transform: PathTransform;
  readonly pendingMergeTargetId: string | null;
  readonly selection: Selection;
  readonly dragTarget: DragTarget;
  readonly pointerDidMove: boolean;
  readonly alignmentGuides: AlignmentGuides;
}

export const createPathEditorView = (state: PathEditorViewState, input: PathEditorInput) => {
  const toWorldPoint = (point: EditorPoint): EditorPoint => transformPoint(point, state.transform);

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
    for (let index = 0; index < state.anchors.length - 1; index += 1) {
      result.push({
        index,
        d: buildSegmentPath(state.anchors[index], state.anchors[index + 1]),
      });
    }
    if (state.closed && state.anchors.length > 1) {
      const index = state.anchors.length - 1;
      result.push({
        index,
        d: buildSegmentPath(state.anchors[index], state.anchors[0]),
      });
    }
    return result;
  });

  const combinedPath = $derived(segments.map((segment, index) => (
    index === 0 ? segment.d : segment.d.replace(/^M \S+ \S+ /, '')
  )).join(' '));
  const plottedAnchors = $derived(state.anchors.map((anchor, index) => ({
    ...toPlotPoint(toWorldPoint(anchor)),
    id: anchor.id,
    index,
    mergeTarget: state.pendingMergeTargetId === anchor.id,
    selected: input.readonly
      ? input.selectedAnchorId === anchor.id
      : state.selection?.kind === 'anchors' && state.selection.anchorIds.includes(anchor.id),
  })));
  const selectedAnchor = $derived.by(() => {
    if (state.selection?.kind !== 'anchors' || state.selection.anchorIds.length !== 1) {
      return null;
    }
    const anchorId = state.selection.anchorIds[0];
    const index = state.anchors.findIndex((anchor) => anchor.id === anchorId);
    return index >= 0 ? { anchor: state.anchors[index], index } : null;
  });
  const selectedHandles = $derived.by(() => {
    if (!selectedAnchor || input.readonly) {
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
        nodeId: selectedAnchor.anchor.id,
        kind,
        x: plotted.x,
        y: plotted.y,
        anchorX: anchorPlot.x,
        anchorY: anchorPlot.y,
      }];
    });
  });
  const pathSelection = $derived.by(() => {
    if (input.readonly || state.selection?.kind !== 'path') {
      return null;
    }
    const bounds = resolvePathBounds(state.anchors, state.closed);
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
      },
      {
        id: 'north-east',
        point: { x: bounds.maxX, y: bounds.maxY },
        fixedPoint: { x: bounds.minX, y: bounds.minY },
      },
      {
        id: 'south-east',
        point: { x: bounds.maxX, y: bounds.minY },
        fixedPoint: { x: bounds.minX, y: bounds.maxY },
      },
      {
        id: 'south-west',
        point: { x: bounds.minX, y: bounds.minY },
        fixedPoint: { x: bounds.maxX, y: bounds.maxY },
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
        rotationCursor: resolveRotationCursor(
          plot.x - centerPlot.x,
          plot.y - centerPlot.y,
        ),
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
    return {
      center,
      polygon: plottedCorners.map((point) => `${point.x},${point.y}`).join(' '),
      scaleHandles,
    };
  });
  const marqueeBox = $derived.by(() => {
    if (state.dragTarget?.kind !== 'marquee' || !state.pointerDidMove) {
      return null;
    }
    const start = toPlotPoint(state.dragTarget.startPoint);
    const current = toPlotPoint(state.dragTarget.currentPoint);
    return {
      left: Math.min(start.x, current.x),
      top: Math.min(start.y, current.y),
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y),
    };
  });
  const gridLineOffsets = $derived(GRID_POSITIONS.map((position) => toPlotPoint({ x: position, y: position }).x));
  const plottedAlignmentGuides = $derived({
    x: state.alignmentGuides.x === null
      ? null
      : toPlotPoint({ x: state.alignmentGuides.x, y: PATH_COORDINATE_MIN }).x,
    y: state.alignmentGuides.y === null
      ? null
      : toPlotPoint({ x: PATH_COORDINATE_MIN, y: state.alignmentGuides.y }).y,
  });
  const previewPoint = $derived.by(() => {
    if (input.previewProgress01 === null || state.anchors.length < 2) {
      return null;
    }
    const point = sampleAnimatedPathAtProgress(
      state.anchors,
      state.closed,
      input.previewStartAnchorId,
      input.previewDirection,
      clamp(input.previewProgress01, 0, 1),
      toPathAffine(state.transform),
    );
    return point ? toPlotPoint(point) : null;
  });

  return {
    get segments() { return segments; },
    get combinedPath() { return combinedPath; },
    get plottedAnchors() { return plottedAnchors; },
    get selectedHandles() { return selectedHandles; },
    get pathSelection() { return pathSelection; },
    get marqueeBox() { return marqueeBox; },
    get gridLineOffsets() { return gridLineOffsets; },
    get plottedAlignmentGuides() { return plottedAlignmentGuides; },
    get previewPoint() { return previewPoint; },
  };
};
