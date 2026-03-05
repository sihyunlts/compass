<script lang="ts">
  /**
   * Renders Launchpad preview cells and overlay strokes for rack and popout modes.
   * Consumes precomputed surface view models and only handles DOM/canvas drawing.
   */
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';

  import { lerp } from '../../shared/math';
  import {
    DEFAULT_OVERLAY_WORLD_BOUNDS,
    createEmptyPreviewSurfaceViewModel,
    type PreviewSurfaceViewModel,
  } from '../features/preview/view-model';

  type PreviewSurfaceMode = 'rack' | 'popout';

  const PREVIEW_COLS = 10;
  const PREVIEW_ROWS = 10;
  const BASE_STAGE_CSS_SIZE = 214;

  let {
    surfaceModel = createEmptyPreviewSurfaceViewModel(),
    mode = 'rack',
  } = $props<{
    surfaceModel?: PreviewSurfaceViewModel;
    mode: PreviewSurfaceMode;
  }>();

  let stageEl: HTMLElement | null = $state(null);
  let overlayCanvasEl: HTMLCanvasElement | null = $state(null);
  let isMounted = false;
  let ledCellsByPitch = new SvelteMap<number, HTMLElement>();
  let overlayContext: CanvasRenderingContext2D | null = null;
  let overlayStrokes: Array<PreviewSurfaceViewModel['overlayStrokes'][number]> = [];
  let canvasWidth = 0;
  let canvasHeight = 0;
  let overlayWorldBounds = DEFAULT_OVERLAY_WORLD_BOUNDS;
  let xCentersByCoord: number[] | null = null;
  let yCentersByCoord: number[] | null = null;
  let lastRenderedModel: PreviewSurfaceViewModel['launchpadModel'] | null = null;
  let surfaceWidth = $state(0);
  let surfaceHeight = $state(0);

  const resolveLedCellsByPitch = (): SvelteMap<number, HTMLElement> => {
    if (!stageEl) {
      return new SvelteMap<number, HTMLElement>();
    }

    const cells = stageEl.querySelectorAll<HTMLElement>('.preview-button');
    const cellByPitch = new SvelteMap<number, HTMLElement>();
    const count = Math.min(surfaceModel.cells.length, cells.length);
    for (let index = 0; index < count; index += 1) {
      const model = surfaceModel.cells[index];
      const cellEl = cells[index];
      for (const pitch of model.pitches) {
        cellByPitch.set(pitch, cellEl);
      }
    }

    return cellByPitch;
  };

  const resolveGridCenters = (): void => {
    if (!stageEl || !overlayCanvasEl) {
      xCentersByCoord = null;
      yCentersByCoord = null;
      return;
    }

    const cells = stageEl.querySelectorAll<HTMLElement>('.preview-button');
    if (cells.length < PREVIEW_ROWS * PREVIEW_COLS) {
      xCentersByCoord = null;
      yCentersByCoord = null;
      return;
    }

    const overlayRect = overlayCanvasEl.getBoundingClientRect();
    const nextXCenters: number[] = [];
    for (let col = 0; col < PREVIEW_COLS; col += 1) {
      const cell = cells[col];
      const rect = cell.getBoundingClientRect();
      nextXCenters.push(rect.left - overlayRect.left + (rect.width / 2));
    }

    const nextYCenters: number[] = [];
    for (let y = 0; y < PREVIEW_ROWS; y += 1) {
      const row = PREVIEW_ROWS - 1 - y;
      const cell = cells[row * PREVIEW_COLS];
      const rect = cell.getBoundingClientRect();
      nextYCenters.push(rect.top - overlayRect.top + (rect.height / 2));
    }

    xCentersByCoord = nextXCenters;
    yCentersByCoord = nextYCenters;
  };

  const sampleAxisCenter = (centers: ReadonlyArray<number>, value: number): number => {
    const lastIndex = centers.length - 1;
    if (lastIndex <= 0) {
      return centers[0] ?? 0;
    }

    if (value <= 0) {
      const step = centers[1] - centers[0];
      return centers[0] + (value * step);
    }
    if (value >= lastIndex) {
      const step = centers[lastIndex] - centers[lastIndex - 1];
      return centers[lastIndex] + ((value - lastIndex) * step);
    }

    const index = Math.floor(value);
    const t = value - index;
    return lerp(centers[index], centers[index + 1], t);
  };

  const toCanvasPoint = (pointX: number, pointY: number): { x: number; y: number } => {
    if (!xCentersByCoord || !yCentersByCoord) {
      const spanX = Math.max(1e-9, overlayWorldBounds.maxX - overlayWorldBounds.minX);
      const spanY = Math.max(1e-9, overlayWorldBounds.maxY - overlayWorldBounds.minY);
      const ratioX = (pointX - overlayWorldBounds.minX) / spanX;
      const ratioY = (pointY - overlayWorldBounds.minY) / spanY;
      return {
        x: ratioX * canvasWidth,
        y: (1 - ratioY) * canvasHeight,
      };
    }

    return {
      x: sampleAxisCenter(xCentersByCoord, pointX),
      y: sampleAxisCenter(yCentersByCoord, pointY),
    };
  };

  const drawOverlay = (): void => {
    if (!overlayContext) {
      return;
    }

    overlayContext.clearRect(0, 0, canvasWidth, canvasHeight);
    if (canvasWidth <= 0 || canvasHeight <= 0) {
      return;
    }

    overlayContext.lineWidth = 1.6;
    overlayContext.strokeStyle = 'rgb(255 255 255)';
    for (const stroke of overlayStrokes) {
      if (stroke.points.length < 2) {
        continue;
      }
      const first = stroke.points[0];
      const start = toCanvasPoint(first.x, first.y);
      overlayContext.beginPath();
      overlayContext.moveTo(start.x, start.y);
      for (let index = 1; index < stroke.points.length; index += 1) {
        const point = stroke.points[index];
        const mapped = toCanvasPoint(point.x, point.y);
        overlayContext.lineTo(mapped.x, mapped.y);
      }
      if (stroke.closed) {
        overlayContext.closePath();
      }
      overlayContext.stroke();
    }
  };

  const resizeCanvasLayer = (
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    dpr: number,
  ): void => {
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const resizeSurfaceCanvases = (): void => {
    if (!stageEl || !overlayCanvasEl || !overlayContext) {
      return;
    }

    const stageRect = stageEl.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(stageRect.width || BASE_STAGE_CSS_SIZE));
    const nextHeight = Math.max(1, Math.round(stageRect.height || BASE_STAGE_CSS_SIZE));
    const dpr = window.devicePixelRatio || 1;

    resizeCanvasLayer(overlayCanvasEl, overlayContext, nextWidth, nextHeight, dpr);
    canvasWidth = nextWidth;
    canvasHeight = nextHeight;
    resolveGridCenters();
    drawOverlay();
  };

  const clearOverlay = (): void => {
    if (overlayContext) {
      overlayContext.clearRect(0, 0, canvasWidth, canvasHeight);
    }
  };

  const applySurfaceModel = (nextSurfaceModel: PreviewSurfaceViewModel): void => {
    for (const cell of ledCellsByPitch.values()) {
      cell.classList.remove('is-lit');
      cell.style.removeProperty('--led-rgb');
    }

    overlayWorldBounds = nextSurfaceModel.overlayWorldBounds;
    if (!nextSurfaceModel.isGuideEnabled) {
      overlayStrokes = [];
      clearOverlay();
    } else {
      overlayStrokes = [...nextSurfaceModel.overlayStrokes];
      drawOverlay();
    }

    for (const cell of nextSurfaceModel.activeCells) {
      const target = ledCellsByPitch.get(cell.pitch);
      if (!target) {
        continue;
      }
      target.classList.add('is-lit');
      target.style.setProperty('--led-rgb', cell.rgb);
    }
  };

  const isGuideVisible = (): boolean => surfaceModel.isGuideEnabled;

  onMount(() => {
    if (!stageEl || !overlayCanvasEl) {
      throw new Error('Launchpad preview surface bootstrap failed: missing required elements');
    }

    ledCellsByPitch = resolveLedCellsByPitch();
    overlayContext = overlayCanvasEl.getContext('2d');
    if (!overlayContext) {
      throw new Error('Launchpad preview surface bootstrap failed: canvas context unavailable');
    }

    resizeSurfaceCanvases();
    applySurfaceModel(surfaceModel);
    isMounted = true;

    return () => {
      isMounted = false;
      ledCellsByPitch = new SvelteMap<number, HTMLElement>();
      overlayContext = null;
    };
  });

  $effect(() => {
    if (!isMounted || surfaceWidth <= 0 || surfaceHeight <= 0) {
      return;
    }

    resizeSurfaceCanvases();
  });

  $effect(() => {
    if (!isMounted) {
      return;
    }

    if (lastRenderedModel !== surfaceModel.launchpadModel) {
      lastRenderedModel = surfaceModel.launchpadModel;
      ledCellsByPitch = resolveLedCellsByPitch();
      resolveGridCenters();
    }

    applySurfaceModel(surfaceModel);
  });
</script>

<div
  class={`preview-launchpad mode-${mode}`}
  class:is-guide-enabled={isGuideVisible()}
  bind:this={stageEl}
  bind:clientWidth={surfaceWidth}
  bind:clientHeight={surfaceHeight}
  style={surfaceHeight > 0 ? `width: ${surfaceHeight}px` : ''}
  role="img"
  aria-label="Launchpad LED preview"
>
  {#each surfaceModel.cells as cell (cell.key)}
    <div
      class="preview-button"
      class:is-button={cell.pitches.length > 0}
      class:is-edge-button={cell.isEdgeButton}
      class:is-corner-placeholder={cell.isCornerPlaceholder}
    ></div>
  {/each}
  <canvas
    class="preview-overlay"
    aria-hidden="true"
    bind:this={overlayCanvasEl}
  ></canvas>
</div>

<style lang="scss">
  .preview-launchpad {
    position: relative;
    border: 1px solid var(--neutral-20);
    border-radius: var(--radius-4);
    background: var(--neutral-00);
    flex: 1;
    display: grid;
    grid-template-columns: repeat(10, minmax(0, 1fr));
    grid-template-rows: repeat(10, minmax(0, 1fr));
    gap: var(--gap-2);
    padding: var(--gap-8);

    &.is-guide-enabled {
      .preview-button {
        opacity: 0.4;
      }

      .preview-overlay {
        opacity: 1;
      }
    }

    &.mode-popout {
      flex: 1;
      width: 100%;
      min-height: 0;
      max-width: 100%;
      max-height: 100%;
      align-self: center;
    }
  }

  .preview-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0;
    transition: opacity 200ms ease;
    z-index: 3;
  }

  .preview-button {
    border-radius: var(--radius-percent-3);
    z-index: 1;
    transition: opacity 200ms ease;

    &.is-button {
      background: var(--neutral-20);

      &.is-edge-button {
        position: relative;
        overflow: hidden;

        &::after {
          content: '';
          position: absolute;
          inset: 0.125rem;
          border-radius: var(--radius-2);
          background: var(--neutral-00);
          pointer-events: none;
        }
      }

      &.is-corner-placeholder {
        width: 50%;
        height: 50%;
        align-self: center;
        justify-self: center;
      }

      &.is-lit {
        background: rgb(var(--led-rgb, var(--rgb-led-default)));
      }
    }
  }
</style>
