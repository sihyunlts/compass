<script lang="ts">
  /**
   * Renders Launchpad preview cells and overlay strokes for rack and popout modes.
   * Converts preview-window state into frame-based LED and vector display models.
   */
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';

  import {
    generateOverlayFrames,
    getLaunchpadRuntimeMap,
    resolveLaunchpadModel,
    type OverlayFrameStroke,
  } from '../../domain';
  import { clamp, lerp } from '../../shared/math';
  import type { LaunchpadButton, LaunchpadModel, PreviewWindowState } from '../../shared/types';
  import {
    PREVIEW_FRAME_COUNT,
    toPreviewFrameBeat,
    toPreviewFrameIndex,
  } from '../services/preview-cache';

  type PreviewSurfaceMode = 'rack' | 'popout';

  const PREVIEW_COLS = 10;
  const PREVIEW_ROWS = 10;
  const OVERLAY_SAMPLE_STEP = 0.25;
  const BASE_STAGE_CSS_SIZE = 214;
  const COMPOSITION_MIN = 0;
  const COMPOSITION_MAX = 9;
  const OVERLAY_WORLD_BASE_PADDING = 4;
  const OVERLAY_WORLD_PADDING_STEP = 2;
  const OVERLAY_WORLD_MAX_PADDING = 14;

  interface OverlayWorldBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  }

  interface PreviewCellModel {
    key: string;
    pitches: number[];
    isEdgeButton: boolean;
    isCornerPlaceholder: boolean;
  }

  let {
    previewState = null,
    mode = 'rack',
  } = $props<{
    previewState: PreviewWindowState | null;
    mode: PreviewSurfaceMode;
  }>();

  const previewFrameBeats: number[] = [];
  for (let index = 0; index < PREVIEW_FRAME_COUNT; index += 1) {
    previewFrameBeats.push(toPreviewFrameBeat(index));
  }

  const activeLaunchpadModel = $derived.by<LaunchpadModel>(() =>
    resolveLaunchpadModel(previewState?.launchpadModel));
  const launchpadButtons = $derived.by(() =>
    getLaunchpadRuntimeMap(activeLaunchpadModel).buttons);

  const cellKey = (row: number, col: number): string => `${row}:${col}`;

  const buttonToPreviewCell = (
    button: LaunchpadButton,
  ): { row: number; col: number } | null => {
    switch (button.zone) {
      case 'grid':
        return { row: 9 - button.y, col: button.x };
      case 'left':
        if (button.id === 'left-top') {
          return { row: 0, col: 0 };
        }
        return { row: 9 - button.y, col: 0 };
      case 'right':
        return { row: 9 - button.y, col: 9 };
      case 'top':
        return { row: 0, col: button.x };
      case 'bottom':
        return { row: 9, col: button.x };
      case 'logo':
        return { row: 0, col: 9 };
      default:
        return null;
    }
  };

  const isCornerPlaceholderCell = (
    buttons: ReadonlyArray<LaunchpadButton>,
  ): boolean => {
    if (buttons.length !== 1) {
      return false;
    }
    const button = buttons[0];
    return button.id === 'bottom-corner-left'
      || button.id === 'bottom-corner-right'
      || button.id === 'left-top'
      || button.id === 'logo';
  };

  const isEdgeButtonCell = (
    buttons: ReadonlyArray<LaunchpadButton>,
  ): boolean => buttons.some((button) =>
    button.zone === 'left'
    || button.zone === 'right'
    || button.zone === 'top'
    || button.zone === 'bottom'
    || button.zone === 'logo');

  const toNoteNumber = (button: LaunchpadButton): number | null =>
    button.output.kind === 'note' ? button.output.number : null;

  const buildPreviewCells = (
    buttons: ReadonlyArray<LaunchpadButton>,
  ): PreviewCellModel[] => {
    const buttonsByCell = new SvelteMap<string, LaunchpadButton[]>();

    for (const button of buttons) {
      if (button.output.kind !== 'note') {
        continue;
      }

      const cell = buttonToPreviewCell(button);
      if (!cell) {
        continue;
      }

      const key = cellKey(cell.row, cell.col);
      const list = buttonsByCell.get(key);
      if (list) {
        list.push(button);
      } else {
        buttonsByCell.set(key, [button]);
      }
    }

    const cells: PreviewCellModel[] = [];
    for (let row = 0; row < PREVIEW_ROWS; row += 1) {
      for (let col = 0; col < PREVIEW_COLS; col += 1) {
        const key = cellKey(row, col);
        const cellButtons = buttonsByCell.get(key) ?? [];
        const pitches: number[] = [];
        for (const button of cellButtons) {
          const note = toNoteNumber(button);
          if (note !== null) {
            pitches.push(note);
          }
        }
        cells.push({
          key,
          pitches,
          isEdgeButton: isEdgeButtonCell(cellButtons),
          isCornerPlaceholder: isCornerPlaceholderCell(cellButtons),
        });
      }
    }

    return cells;
  };

  const previewCells = $derived.by(() => buildPreviewCells(launchpadButtons));

  const resolveOverlayWorldBounds = (padding: number): OverlayWorldBounds => ({
    minX: COMPOSITION_MIN - padding,
    maxX: COMPOSITION_MAX + padding,
    minY: COMPOSITION_MIN - padding,
    maxY: COMPOSITION_MAX + padding,
  });

  const touchesOverlayBoundary = (
    strokes: ReadonlyArray<OverlayFrameStroke>,
    bounds: OverlayWorldBounds,
  ): boolean => {
    if (strokes.length === 0) {
      return false;
    }

    const edgeMargin = OVERLAY_SAMPLE_STEP * 1.1;
    const minXEdge = bounds.minX + edgeMargin;
    const maxXEdge = bounds.maxX - edgeMargin;
    const minYEdge = bounds.minY + edgeMargin;
    const maxYEdge = bounds.maxY - edgeMargin;

    for (const stroke of strokes) {
      for (const point of stroke.points) {
        if (
          point.x <= minXEdge
          || point.x >= maxXEdge
          || point.y <= minYEdge
          || point.y >= maxYEdge
        ) {
          return true;
        }
      }
    }

    return false;
  };

  let stageEl: HTMLElement | null = $state(null);
  let overlayCanvasEl: HTMLCanvasElement | null = $state(null);
  let isMounted = false;
  let ledCellsByPitch = new SvelteMap<number, HTMLElement>();
  let overlayContext: CanvasRenderingContext2D | null = null;
  let overlayStrokes: OverlayFrameStroke[] = [];
  let overlayFramesByIndex: OverlayFrameStroke[][] = [];
  let overlayFrameIndex = -1;
  let overlayCachePreviewRevision: number | null = null;
  let overlayCacheModel: LaunchpadModel | null = null;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let overlayPadding = OVERLAY_WORLD_BASE_PADDING;
  let overlayWorldBounds = resolveOverlayWorldBounds(overlayPadding);
  let xCentersByCoord: number[] | null = null;
  let yCentersByCoord: number[] | null = null;
  let wasGuideEnabled = true;
  let lastRenderedModel: LaunchpadModel | null = null;
  let surfaceWidth = $state(0);
  let surfaceHeight = $state(0);

  const resolveLedCellsByPitch = (): SvelteMap<number, HTMLElement> => {
    if (!stageEl) {
      return new SvelteMap<number, HTMLElement>();
    }

    const cells = stageEl.querySelectorAll<HTMLElement>('.preview-button');
    const cellByPitch = new SvelteMap<number, HTMLElement>();
    const count = Math.min(previewCells.length, cells.length);
    for (let index = 0; index < count; index += 1) {
      const model = previewCells[index];
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

  const buildOverlayFrameCache = (
    chain: PreviewWindowState['chain'],
    bounds: OverlayWorldBounds,
    launchpadModel: LaunchpadModel,
  ): OverlayFrameStroke[][] => generateOverlayFrames({
    chain,
    beats01: previewFrameBeats,
    sampleStep: OVERLAY_SAMPLE_STEP,
    bounds,
    launchpadModel,
  });

  const touchesOverlayFrameCacheBoundary = (
    framesByIndex: ReadonlyArray<ReadonlyArray<OverlayFrameStroke>>,
    bounds: OverlayWorldBounds,
  ): boolean => {
    for (const frameStrokes of framesByIndex) {
      if (touchesOverlayBoundary(frameStrokes, bounds)) {
        return true;
      }
    }
    return false;
  };

  const rebuildOverlayFrameCache = (nextState: PreviewWindowState): void => {
    const model = resolveLaunchpadModel(nextState.launchpadModel);
    let nextPadding = OVERLAY_WORLD_BASE_PADDING;
    let nextBounds = resolveOverlayWorldBounds(nextPadding);
    let nextFramesByIndex = buildOverlayFrameCache(
      nextState.chain,
      nextBounds,
      model,
    );

    while (
      touchesOverlayFrameCacheBoundary(nextFramesByIndex, nextBounds)
      && nextPadding < OVERLAY_WORLD_MAX_PADDING
    ) {
      nextPadding = Math.min(OVERLAY_WORLD_MAX_PADDING, nextPadding + OVERLAY_WORLD_PADDING_STEP);
      nextBounds = resolveOverlayWorldBounds(nextPadding);
      nextFramesByIndex = buildOverlayFrameCache(
        nextState.chain,
        nextBounds,
        model,
      );
    }

    overlayPadding = nextPadding;
    overlayWorldBounds = nextBounds;
    overlayFramesByIndex = nextFramesByIndex;
    overlayCachePreviewRevision = nextState.previewRevision;
    overlayCacheModel = model;
  };

  const applyOverlayFrameByBeat = (beat01: number): void => {
    const nextFrameIndex = toPreviewFrameIndex(beat01);
    if (overlayFrameIndex === nextFrameIndex && wasGuideEnabled) {
      return;
    }
    overlayFrameIndex = nextFrameIndex;
    overlayStrokes = overlayFramesByIndex[nextFrameIndex] ?? [];
    drawOverlay();
  };

  const applyState = (nextState: PreviewWindowState | null): void => {
    for (const cell of ledCellsByPitch.values()) {
      cell.classList.remove('is-lit');
      cell.style.removeProperty('--led-rgb');
    }

    if (!nextState) {
      overlayFramesByIndex = [];
      overlayFrameIndex = -1;
      overlayStrokes = [];
      overlayCachePreviewRevision = null;
      overlayCacheModel = null;
      wasGuideEnabled = false;
      clearOverlay();
      return;
    }

    const nextModel = resolveLaunchpadModel(nextState.launchpadModel);
    const isGuideEnabled = nextState.isGuideEnabled !== false;
    if (!isGuideEnabled) {
      overlayStrokes = [];
      overlayFrameIndex = -1;
      wasGuideEnabled = false;
      clearOverlay();
    } else {
      if (
        nextState.previewRevision !== overlayCachePreviewRevision
        || nextModel !== overlayCacheModel
        || overlayFramesByIndex.length !== PREVIEW_FRAME_COUNT
      ) {
        rebuildOverlayFrameCache(nextState);
        overlayFrameIndex = -1;
      }
      applyOverlayFrameByBeat(clamp(nextState.currentBeat, 0, 1));
      wasGuideEnabled = true;
    }

    for (const cell of nextState.activeCells) {
      const target = ledCellsByPitch.get(cell.pitch);
      if (!target) {
        continue;
      }
      target.classList.add('is-lit');
      target.style.setProperty('--led-rgb', cell.rgb);
    }
  };

  const isGuideVisible = (): boolean => previewState?.isGuideEnabled !== false;

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
    applyState(previewState);
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

    if (lastRenderedModel !== activeLaunchpadModel) {
      lastRenderedModel = activeLaunchpadModel;
      ledCellsByPitch = resolveLedCellsByPitch();
      resolveGridCenters();
      overlayCachePreviewRevision = null;
      overlayCacheModel = null;
    }

    applyState(previewState);
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
  {#each previewCells as cell (cell.key)}
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
      background: var(--neutral-30);

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
