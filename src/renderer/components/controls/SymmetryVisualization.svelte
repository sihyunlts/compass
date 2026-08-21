<svelte:options runes={true} />

<script lang="ts">
  import { buildSymmetryTransformPlan } from '../../../core/symmetry';
  import {
    resolveRotationCursor,
    resolveRotationSnap,
  } from './rotation-interaction';

  let {
    mode,
    sourceScope,
    count,
    directionDeg,
    centerX,
    centerY,
    visualizationLabel,
    directionLabel,
    directionStep,
    onDirectionChange,
  } = $props<{
    mode: 'reflection' | 'rotation';
    sourceScope: 'sector' | 'entire';
    count: number;
    directionDeg: number;
    centerX: number;
    centerY: number;
    visualizationLabel: string;
    directionLabel: string;
    directionStep: number;
    onDirectionChange: (value: number, finalize: boolean) => void;
  }>();

  let directionPointerId = $state<number | null>(null);
  let draggedDirectionDeg = $state(0);
  let didDragDirection = $state(false);

  const center = $derived({
    x: (centerX / 9) * 100,
    y: (1 - centerY / 9) * 100,
  });
  const visualizationPlan = $derived(buildSymmetryTransformPlan({
    mode,
    sourceScope,
    count,
    directionDeg,
    center: { x: centerX, y: centerY },
  }));
  const sourceDirectionDeg = $derived(
    visualizationPlan.steps[0]?.targetAngleDeg ?? 0,
  );

  const toPoint = (
    angle: number,
    radius: number,
  ): { x: number; y: number } => {
    const radians = angle * Math.PI / 180;
    return {
      x: center.x + Math.cos(radians) * radius,
      y: center.y - Math.sin(radians) * radius,
    };
  };

  const divisionLines = $derived(visualizationPlan.divisionAnglesDeg.map((angle) => ({
    angle,
    end: toPoint(angle, 160),
  })));
  const directionMarkerRadius = $derived.by(() => {
    const radians = sourceDirectionDeg * Math.PI / 180;
    const unitX = Math.cos(radians);
    const unitY = -Math.sin(radians);
    const distanceToVerticalEdge = Math.abs(unitX) < 1e-9
      ? Number.POSITIVE_INFINITY
      : (unitX > 0 ? 100 - center.x : -center.x) / unitX;
    const distanceToHorizontalEdge = Math.abs(unitY) < 1e-9
      ? Number.POSITIVE_INFINITY
      : (unitY > 0 ? 100 - center.y : -center.y) / unitY;
    return Math.max(0, Math.min(
      31,
      distanceToVerticalEdge,
      distanceToHorizontalEdge,
    ));
  });
  const directionMarker = $derived(toPoint(sourceDirectionDeg, directionMarkerRadius));
  const directionCursor = $derived(resolveRotationCursor(
    directionMarker.x - center.x,
    directionMarker.y - center.y,
  ));
  const sourceWedgePath = $derived.by(() => {
    const halfWidth = visualizationPlan.sectorWidthDeg / 2;
    const start = toPoint(sourceDirectionDeg - halfWidth, 160);
    const end = toPoint(sourceDirectionDeg + halfWidth, 160);
    return [
      `M ${center.x.toFixed(3)} ${center.y.toFixed(3)}`,
      `L ${start.x.toFixed(3)} ${start.y.toFixed(3)}`,
      `A 160 160 0 0 0 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`,
      'Z',
    ].join(' ');
  });

  const resolvePointerDirection = (
    handle: SVGGElement,
    event: PointerEvent,
  ): number | null => {
    const svg = handle.ownerSVGElement;
    if (!svg) {
      return null;
    }

    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const pointerX = ((event.clientX - rect.left) / rect.width) * 100;
    const pointerY = ((event.clientY - rect.top) / rect.height) * 100;
    const rawDirectionRadians = Math.atan2(center.y - pointerY, pointerX - center.x);
    const radiusPx = Math.hypot(
      (pointerX - center.x) * rect.width / 100,
      (pointerY - center.y) * rect.height / 100,
    );
    const rotationSnap = resolveRotationSnap({
      requestedRadians: rawDirectionRadians,
      radiusPx,
      lockToIncrement: event.shiftKey,
      snapEnabled: !event.ctrlKey,
    });
    const resolvedDirectionDeg = rotationSnap.radians * 180 / Math.PI;
    const steppedDirection = Math.round(
      resolvedDirectionDeg / directionStep,
    ) * directionStep;
    return ((steppedDirection % 360) + 360) % 360;
  };

  const handleDirectionPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as SVGGElement;
    directionPointerId = event.pointerId;
    draggedDirectionDeg = directionDeg;
    didDragDirection = false;
    handle.setPointerCapture(event.pointerId);
  };

  const handleDirectionPointerMove = (event: PointerEvent): void => {
    if (directionPointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    const nextDirectionDeg = resolvePointerDirection(
      event.currentTarget as SVGGElement,
      event,
    );
    if (
      nextDirectionDeg === null
      || Math.abs(nextDirectionDeg - draggedDirectionDeg) < 0.0001
    ) {
      return;
    }

    draggedDirectionDeg = nextDirectionDeg;
    didDragDirection = true;
    onDirectionChange(nextDirectionDeg, false);
  };

  const finishDirectionDrag = (event: PointerEvent): void => {
    if (directionPointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    const handle = event.currentTarget as SVGGElement;
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    directionPointerId = null;
    if (didDragDirection) {
      onDirectionChange(draggedDirectionDeg, true);
    }
    didDragDirection = false;
  };

  const handleDirectionKeyDown = (event: KeyboardEvent): void => {
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight'
      ? 1
      : event.key === 'ArrowDown' || event.key === 'ArrowLeft'
        ? -1
        : 0;
    if (direction === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const nextDirectionDeg = (
      (directionDeg + direction * directionStep) % 360 + 360
    ) % 360;
    onDirectionChange(nextDirectionDeg, true);
  };
</script>

<svg
  class="symmetry-visualization"
  viewBox="0 0 100 100"
  preserveAspectRatio="none"
  role="group"
  aria-label={visualizationLabel}
>
  {#if sourceScope === 'sector'}
    <path class="source-area" d={sourceWedgePath}></path>
  {:else}
    <rect class="source-area" x="0" y="0" width="100" height="100"></rect>
  {/if}

  {#each divisionLines as line (`division:${line.angle}`)}
    <line
      class="division-guide"
      x1={center.x}
      y1={center.y}
      x2={line.end.x}
      y2={line.end.y}
    ></line>
  {/each}

  {#if sourceScope === 'sector'}
    <line
      class="source-direction"
      x1={center.x}
      y1={center.y}
      x2={directionMarker.x}
      y2={directionMarker.y}
    ></line>
    <g
      class="direction-handle"
      role="slider"
      tabindex="0"
      aria-label={directionLabel}
      aria-valuemin="0"
      aria-valuemax="359"
      aria-valuenow={directionDeg}
      aria-valuetext={`${directionDeg}°`}
      transform={`translate(${directionMarker.x.toFixed(3)} ${directionMarker.y.toFixed(3)})`}
      style={`cursor:${directionCursor};`}
      onpointerdown={handleDirectionPointerDown}
      onpointermove={handleDirectionPointerMove}
      onpointerup={finishDirectionDrag}
      onpointercancel={finishDirectionDrag}
      onlostpointercapture={finishDirectionDrag}
      onkeydown={handleDirectionKeyDown}
    >
      <circle class="direction-handle-target" cx="0" cy="0" r="8"></circle>
      <circle class="direction-handle-grip" cx="0" cy="0" r="3.5"></circle>
    </g>
  {/if}
</svg>

<style lang="scss">
  .symmetry-visualization {
    display: block;
    width: 100%;
    height: 100%;
  }

  .source-area {
    fill: color-mix(
      in srgb,
      var(--device-control-accent, var(--color-surface-inverse)) 18%,
      transparent
    );
  }

  .source-direction {
    stroke: var(--device-control-accent, var(--color-surface-inverse));
    stroke-width: 1.2;
    vector-effect: non-scaling-stroke;
  }

  .division-guide {
    stroke: var(--device-control-accent, var(--color-surface-inverse));
    stroke-width: 1;
    stroke-dasharray: 3 3;
    vector-effect: non-scaling-stroke;
  }

  .direction-handle {
    pointer-events: all;
    touch-action: none;
  }

  .direction-handle-target {
    fill: transparent;
  }

  .direction-handle-grip {
    fill: var(--color-surface);
    stroke: var(--device-control-accent, var(--color-surface-inverse));
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }

</style>
