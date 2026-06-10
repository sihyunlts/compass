<svelte:options runes={true} />

<script lang="ts">
  import type { PathPoint } from '../../../shared/model';
  import FieldShell from '../fields/FieldShell.svelte';
  import {
    PATH_COORDINATE_MAX,
    PATH_COORDINATE_MIN,
    PATH_POINT_MIN_COUNT,
    sanitizePathPoints,
  } from '../../../devices/path/schema';
  import { clamp } from '../../../shared/math';

  let {
    deviceId,
    points = [] as PathPoint[],
  } = $props<{
    deviceId: string;
    points: PathPoint[];
  }>();

  let editorEl = $state<HTMLDivElement | null>(null);
  let hiddenInputEl = $state<HTMLInputElement | null>(null);
  let localPoints = $state<PathPoint[]>(sanitizePathPoints([]));
  let selectedPointIndex = $state(0);
  let draggingPointIndex = $state<number | null>(null);
  let pointerDownClientX = $state(0);
  let pointerDownClientY = $state(0);
  let dragDidMove = $state(false);
  let suppressSurfaceClick = $state(false);

  const COORDINATE_RANGE = PATH_COORDINATE_MAX - PATH_COORDINATE_MIN;
  const SOFT_SNAP_DISTANCE_PX = 10;
  const DRAG_THRESHOLD_PX = 4;
  const SNAP_VALUES = Array.from(
    { length: (COORDINATE_RANGE * 2) + 1 },
    (_, index) => PATH_COORDINATE_MIN + index * 0.5,
  );
  const GRID_POSITIONS = Array.from(
    { length: COORDINATE_RANGE + 1 },
    (_, index) => PATH_COORDINATE_MIN + index,
  );

  const roundCoordinate = (value: number): number =>
    Number(value.toFixed(3));

  const clampCoordinate = (value: number): number =>
    roundCoordinate(clamp(value, PATH_COORDINATE_MIN, PATH_COORDINATE_MAX));

  const toSoftSnappedCoordinate = (
    value: number,
    spanPx: number,
  ): number => {
    if (!Number.isFinite(spanPx) || spanPx <= 0) {
      return clampCoordinate(value);
    }

    const threshold = (SOFT_SNAP_DISTANCE_PX * COORDINATE_RANGE) / spanPx;
    let nearest = value;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const snapValue of SNAP_VALUES) {
      const distance = Math.abs(value - snapValue);
      if (distance < nearestDistance) {
        nearest = snapValue;
        nearestDistance = distance;
      }
    }

    return clampCoordinate(nearestDistance <= threshold ? nearest : value);
  };

  const sanitizeLocalPoints = (
    nextPoints: readonly PathPoint[],
  ): PathPoint[] => sanitizePathPoints(nextPoints);

  const emitPoints = (nextPoints: readonly PathPoint[]): void => {
    localPoints = sanitizeLocalPoints(nextPoints);
    if (!hiddenInputEl) {
      return;
    }

    hiddenInputEl.value = JSON.stringify(localPoints);
    hiddenInputEl.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const resolveEditorPoint = (
    clientX: number,
    clientY: number,
  ): PathPoint | null => {
    if (!editorEl) {
      return null;
    }

    const rect = editorEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const ratioX = clamp((clientX - rect.left) / rect.width, 0, 1);
    const ratioY = clamp((clientY - rect.top) / rect.height, 0, 1);
    const rawX = PATH_COORDINATE_MIN + ratioX * COORDINATE_RANGE;
    const rawY = PATH_COORDINATE_MAX - ratioY * COORDINATE_RANGE;

    return {
      x: toSoftSnappedCoordinate(rawX, rect.width),
      y: toSoftSnappedCoordinate(rawY, rect.height),
    };
  };

  const toPlotX = (x: number): number =>
    ((x - PATH_COORDINATE_MIN) / COORDINATE_RANGE) * 100;

  const toPlotY = (y: number): number =>
    (1 - ((y - PATH_COORDINATE_MIN) / COORDINATE_RANGE)) * 100;

  const plottedPoints = $derived.by(() => localPoints.map((point, index) => ({
    index,
    x: Number(toPlotX(point.x).toFixed(3)),
    y: Number(toPlotY(point.y).toFixed(3)),
    point,
  })));

  const gridLineOffsets = $derived.by(() =>
    GRID_POSITIONS.map((position) => Number(toPlotX(position).toFixed(3))));

  const pathLine = $derived.by(() => {
    const [firstPoint, ...restPoints] = plottedPoints;
    if (!firstPoint) {
      return '';
    }

    let path = `M ${firstPoint.x} ${firstPoint.y}`;
    for (const point of restPoints) {
      path += ` L ${point.x} ${point.y}`;
    }
    return path;
  });

  const canDeleteSelectedPoint = $derived(
    selectedPointIndex >= 0
    && selectedPointIndex < localPoints.length
    && localPoints.length > PATH_POINT_MIN_COUNT,
  );

  const appendPoint = (point: PathPoint): void => {
    const nextIndex = localPoints.length;
    emitPoints([...localPoints, point]);
    selectedPointIndex = nextIndex;
  };

  const updatePoint = (
    index: number,
    point: PathPoint,
  ): void => {
    if (index < 0 || index >= localPoints.length) {
      return;
    }

    const current = localPoints[index];
    if (
      Math.abs(current.x - point.x) < 0.0001
      && Math.abs(current.y - point.y) < 0.0001
    ) {
      return;
    }

    emitPoints(localPoints.map((item, itemIndex) =>
      (itemIndex === index ? point : item)));
    selectedPointIndex = index;
  };

  const deleteSelectedPoint = (): void => {
    if (!canDeleteSelectedPoint) {
      return;
    }

    const nextPoints = localPoints.filter((_, index) => index !== selectedPointIndex);
    emitPoints(nextPoints);
    selectedPointIndex = Math.max(0, Math.min(selectedPointIndex, nextPoints.length - 1));
  };

  const handleSurfaceClick = (event: MouseEvent): void => {
    if (suppressSurfaceClick) {
      suppressSurfaceClick = false;
      return;
    }

    const target = event.target;
    if (
      target instanceof HTMLElement
      && target.closest('.path-editor-point, .path-editor-toolbar')
    ) {
      return;
    }

    const point = resolveEditorPoint(event.clientX, event.clientY);
    if (point) {
      appendPoint(point);
    }
  };

  const handlePointMouseDown = (
    event: MouseEvent,
    index: number,
  ): void => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    selectedPointIndex = index;
    draggingPointIndex = index;
    pointerDownClientX = event.clientX;
    pointerDownClientY = event.clientY;
    dragDidMove = false;
  };

  const handlePointClick = (event: MouseEvent): void => {
    event.stopPropagation();
  };

  $effect(() => {
    if (draggingPointIndex !== null) {
      return;
    }

    const nextPoints = sanitizeLocalPoints(points);
    localPoints = nextPoints;
    selectedPointIndex = Math.max(
      0,
      Math.min(selectedPointIndex, nextPoints.length - 1),
    );
  });

  $effect(() => {
    const handleMouseMove = (event: MouseEvent): void => {
      if (draggingPointIndex === null) {
        return;
      }

      if (
        !dragDidMove
        && (
          Math.abs(event.clientX - pointerDownClientX) > DRAG_THRESHOLD_PX
          || Math.abs(event.clientY - pointerDownClientY) > DRAG_THRESHOLD_PX
        )
      ) {
        dragDidMove = true;
      }

      const point = resolveEditorPoint(event.clientX, event.clientY);
      if (point) {
        updatePoint(draggingPointIndex, point);
      }
    };

    const handleMouseUp = (): void => {
      if (draggingPointIndex === null) {
        return;
      }

      suppressSurfaceClick = dragDidMove;
      draggingPointIndex = null;
      dragDidMove = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mouseleave', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mouseleave', handleMouseUp);
    };
  });
</script>

<div class="path-editor-wrap">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="path-editor-surface"
    bind:this={editorEl}
    onclick={handleSurfaceClick}
  >
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {#each gridLineOffsets as offset (`x:${offset}`)}
        <line class="path-editor-grid-line" x1={offset} y1="0" x2={offset} y2="100"></line>
      {/each}
      {#each gridLineOffsets as offset (`y:${offset}`)}
        <line class="path-editor-grid-line" x1="0" y1={offset} x2="100" y2={offset}></line>
      {/each}

      {#if pathLine}
        <path class="path-editor-line-halo" d={pathLine}></path>
        <path class="path-editor-line" d={pathLine}></path>
      {/if}
    </svg>

    {#each plottedPoints as plottedPoint (plottedPoint.index)}
      <button
        type="button"
        class="path-editor-point"
        class:is-selected={plottedPoint.index === selectedPointIndex}
        style={`left:${plottedPoint.x}%;top:${plottedPoint.y}%;`}
        aria-label={`Path point ${plottedPoint.index + 1}`}
        onmousedown={(event) => handlePointMouseDown(event, plottedPoint.index)}
        onclick={handlePointClick}
      ></button>
    {/each}
  </div>

  <FieldShell label="Path Points">
    <div class="path-editor-actions">
      <span class="path-editor-count">{localPoints.length}</span>
      <button
        type="button"
        class="path-editor-delete"
        disabled={!canDeleteSelectedPoint}
        onclick={deleteSelectedPoint}
      >
        Delete Selected
      </button>
    </div>
  </FieldShell>

  <input
    bind:this={hiddenInputEl}
    type="hidden"
    value={JSON.stringify(localPoints)}
    data-action="set-path-points"
    data-id={deviceId}
  />
</div>

<style lang="scss">
  .path-editor {
    &-wrap {
      display: grid;
      grid-template-columns: minmax(10rem, 1fr) minmax(7.5rem, auto);
      align-items: start;
      gap: var(--gap-8);
      min-width: 0;
    }

    &-actions {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: var(--gap-8);
      min-width: 0;
    }

    &-actions {
      align-items: stretch;
      justify-content: flex-start;
    }

    &-count {
      min-width: 1.75rem;
      text-align: left;
      color: var(--neutral-50);
      font-size: var(--text-12);
    }

    &-delete {
      width: 100%;
      appearance: none;
      border: 1px solid var(--neutral-30);
      border-radius: var(--radius-4);
      background: var(--neutral-20);
      color: var(--neutral-100);
      font: inherit;
      padding: var(--gap-4) var(--gap-8);
      cursor: pointer;

      &:disabled {
        cursor: default;
        color: var(--neutral-50);
        opacity: 0.6;
      }
    }

    &-surface {
      position: relative;
      aspect-ratio: 1 / 1;
      border-radius: var(--radius-6);
      border: 1px solid var(--neutral-30);
      background: var(--neutral-10);
      overflow: hidden;
      cursor: crosshair;

      svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
      }
    }

    &-grid-line {
      stroke: rgb(var(--rgb-white) / 0.08);
      stroke-width: 0.6;
      vector-effect: non-scaling-stroke;
    }

    &-line-halo {
      fill: none;
      stroke: rgb(var(--rgb-white) / 0.24);
      stroke-width: 3;
      stroke-linecap: round;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }

    &-line {
      fill: none;
      stroke: var(--accent-500);
      stroke-width: 1.4;
      stroke-linecap: round;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }

    &-point {
      position: absolute;
      transform: translate(-50%, -50%);
      width: 0.9rem;
      height: 0.9rem;
      padding: 0;
      border-radius: 999px;
      border: 2px solid var(--neutral-10);
      background: var(--accent-500);
      box-shadow: 0 0 0 1px rgb(var(--rgb-white) / 0.18);
      cursor: grab;

      &.is-selected {
        background: var(--warning-400);
      }

      &:active {
        cursor: grabbing;
      }
    }
  }
</style>
