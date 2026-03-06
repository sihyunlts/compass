<script lang="ts">
  import { onMount } from 'svelte';
  import { clamp } from '../../shared/math';
  import type { RackScrollMetrics } from './device-rack-types';

  const KEYBOARD_SCROLL_STEP_PX = 56;
  const PAGE_SCROLL_RATIO = 0.9;
  const MIN_THUMB_WIDTH_PX = 18;
  const MINIMAP_INSET_PX = 4;
  const MIN_SCROLLBAR_WIDTH_PX = 16;
  const MAX_SCROLLBAR_WIDTH_PX = 180;
  const RACK_MINIMAP_SOURCE_SELECTOR = '.device-card, .group-rail';

  let {
    metrics,
    contentRevision = 0,
    controlsId = 'chain-devices',
    onScrollRequest = () => {},
  } = $props<{
    metrics: RackScrollMetrics;
    contentRevision?: number;
    controlsId?: string;
    onScrollRequest?: (nextScrollLeft: number) => void;
  }>();

  interface ThumbLayout {
    widthPx: number;
    leftPx: number;
    travelPx: number;
  }

  let trackEl = $state<HTMLDivElement | null>(null);
  let trackWidthPx = $state(0);
  let trackHeightPx = $state(0);
  let activePointerId = $state<number | null>(null);
  let dragOffsetPx = $state(0);
  let sourceHeightPx = $state(1);
  let mirrorMarkup = $state('');
  let mirrorSyncFrameId: number | null = null;
  let pendingMirrorSignature: string | null = null;
  let lastAppliedMirrorSignature: string | null = null;
  let hasRackContent = $state(false);
  let occupiedEndRatio = $state(0);

  const maxScrollLeft = $derived.by(() => Math.max(metrics.scrollWidth - metrics.clientWidth, 0));
  const hasOverflow = $derived.by(() => maxScrollLeft > 0.1);
  const valueNow = $derived.by(() => clamp(metrics.scrollLeft, 0, maxScrollLeft));
  const occupiedSourceWidthPx = $derived.by(() => {
    if (occupiedEndRatio <= 0 || metrics.scrollWidth <= 0) {
      return 1;
    }
    return Math.max(metrics.scrollWidth * occupiedEndRatio, 1);
  });
  const viewportHeightPx = $derived.by(() =>
    Math.max(trackHeightPx - (MINIMAP_INSET_PX * 2), 0));
  const baseScale = $derived.by(() => {
    if (viewportHeightPx <= 0 || sourceHeightPx <= 0) {
      return 0;
    }
    return viewportHeightPx / sourceHeightPx;
  });
  const naturalScaledWidthPx = $derived.by(() =>
    Math.max(occupiedSourceWidthPx * baseScale, 0));
  const maxViewportWidthPx = $derived.by(() =>
    Math.max(MAX_SCROLLBAR_WIDTH_PX - (MINIMAP_INSET_PX * 2), 1));
  const targetViewportWidthPx = $derived.by(() =>
    Math.min(naturalScaledWidthPx, maxViewportWidthPx));
  const scrollbarWidthPx = $derived.by(() =>
    clamp(targetViewportWidthPx + (MINIMAP_INSET_PX * 2), MIN_SCROLLBAR_WIDTH_PX, MAX_SCROLLBAR_WIDTH_PX));
  const rootStyle = $derived.by(() =>
    `width:${scrollbarWidthPx.toFixed(2)}px;min-width:${MIN_SCROLLBAR_WIDTH_PX}px;`);

  const resolveThumbLayout = (trackWidth: number): ThumbLayout => {
    if (!hasOverflow || trackWidth <= 0) {
      return { widthPx: Math.max(trackWidth, 0), leftPx: 0, travelPx: 0 };
    }

    const minWidth = Math.min(MIN_THUMB_WIDTH_PX, trackWidth);
    const widthRatio = clamp(metrics.clientWidth / Math.max(metrics.scrollWidth, 1), 0, 1);
    const widthPx = clamp(trackWidth * widthRatio, minWidth, trackWidth);
    const travelPx = Math.max(trackWidth - widthPx, 0);
    const leftRatio = maxScrollLeft <= 0 ? 0 : clamp(valueNow / maxScrollLeft, 0, 1);
    const leftPx = travelPx <= 0 ? 0 : leftRatio * travelPx;
    return { widthPx, leftPx, travelPx };
  };

  const thumbLayout = $derived.by(() => resolveThumbLayout(trackWidthPx));
  const thumbStyle = $derived.by(() =>
    `left:${thumbLayout.leftPx}px;width:${Math.max(thumbLayout.widthPx, 0)}px;`);

  const mirrorStyle = $derived.by(() => {
    const viewportWidth = Math.max(trackWidthPx - (MINIMAP_INSET_PX * 2), 0);
    const viewportHeight = Math.max(trackHeightPx - (MINIMAP_INSET_PX * 2), 0);
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      return 'display:none;';
    }

    const resolvedBaseScale = baseScale;
    const naturalWidth = Math.max(occupiedSourceWidthPx * resolvedBaseScale, 0);
    const compressionRatio = naturalWidth > viewportWidth
      ? (viewportWidth / naturalWidth)
      : 1;
    const scaleY = resolvedBaseScale;
    const scaleX = resolvedBaseScale * compressionRatio;
    return [
      `width:${Math.max(occupiedSourceWidthPx, 1)}px`,
      `height:${Math.max(sourceHeightPx, 1)}px`,
      `transform:scale(${scaleX}, ${scaleY})`,
      'transform-origin:0 0',
    ].join(';');
  });

  const sanitizeMirrorTree = (root: HTMLElement): void => {
    root.removeAttribute('id');
    root.querySelectorAll<HTMLElement>('[id]').forEach((node) => node.removeAttribute('id'));
    root.querySelectorAll<HTMLElement>('.drop-indicator').forEach((node) => node.remove());
    root.querySelectorAll<HTMLElement>('input, select, textarea, button').forEach((node) => {
      node.setAttribute('tabindex', '-1');
    });
  };

  const applySourceMirror = (signature: string): void => {
    const sourceEl = document.getElementById(controlsId);
    if (!(sourceEl instanceof HTMLElement)) {
      hasRackContent = false;
      occupiedEndRatio = 0;
      mirrorMarkup = '';
      sourceHeightPx = 1;
      lastAppliedMirrorSignature = signature;
      return;
    }

    const sourceNodes = sourceEl.querySelectorAll<HTMLElement>(RACK_MINIMAP_SOURCE_SELECTOR);
    if (sourceNodes.length === 0) {
      hasRackContent = false;
      occupiedEndRatio = 0;
      mirrorMarkup = '';
      sourceHeightPx = Math.max(sourceEl.clientHeight, 1);
      lastAppliedMirrorSignature = signature;
      return;
    }

    hasRackContent = true;
    const sourceRect = sourceEl.getBoundingClientRect();
    const sourceScrollLeft = sourceEl.scrollLeft;
    let maxRightInScrollSpace = 0;
    sourceNodes.forEach((node) => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      const rightInScrollSpace = rect.right - sourceRect.left + sourceScrollLeft;
      maxRightInScrollSpace = Math.max(maxRightInScrollSpace, rightInScrollSpace);
    });
    occupiedEndRatio = clamp(maxRightInScrollSpace / Math.max(sourceEl.scrollWidth, 1), 0, 1);

    const mirrorRoot = sourceEl.cloneNode(true);
    if (!(mirrorRoot instanceof HTMLElement)) {
      return;
    }

    sanitizeMirrorTree(mirrorRoot);
    const sourceComputed = window.getComputedStyle(sourceEl);
    mirrorRoot.style.width = `${Math.max(Math.round(occupiedSourceWidthPx), 1)}px`;
    mirrorRoot.style.height = `${Math.max(sourceEl.clientHeight, 1)}px`;
    mirrorRoot.style.display = sourceComputed.display === 'none' ? 'flex' : sourceComputed.display;
    mirrorRoot.style.flexDirection = sourceComputed.flexDirection || 'row';
    mirrorRoot.style.alignItems = sourceComputed.alignItems || 'stretch';
    mirrorRoot.style.gap = sourceComputed.gap || '0px';
    mirrorRoot.style.minHeight = '0';
    mirrorRoot.style.maxHeight = 'none';
    mirrorRoot.style.overflow = 'visible';
    mirrorRoot.style.pointerEvents = 'none';

    sourceHeightPx = Math.max(sourceEl.clientHeight, 1);
    mirrorMarkup = mirrorRoot.outerHTML;
    lastAppliedMirrorSignature = signature;
  };

  const scheduleMirrorSync = (signature: string): void => {
    pendingMirrorSignature = signature;
    if (mirrorSyncFrameId !== null) {
      return;
    }

    mirrorSyncFrameId = window.requestAnimationFrame(() => {
      mirrorSyncFrameId = null;
      const nextSignature = pendingMirrorSignature;
      pendingMirrorSignature = null;
      if (!nextSignature || nextSignature === lastAppliedMirrorSignature) {
        return;
      }
      applySourceMirror(nextSignature);
    });
  };

  const requestCenteredScrollAtClientX = (clientX: number): void => {
    if (!trackEl || !hasOverflow) {
      return;
    }

    const rect = trackEl.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }

    const localX = clamp(clientX - rect.left, 0, rect.width);
    const targetRatio = localX / rect.width;
    const centered = (targetRatio * metrics.scrollWidth) - (metrics.clientWidth / 2);
    onScrollRequest(clamp(centered, 0, maxScrollLeft));
  };

  const requestDragScrollAtClientX = (clientX: number): void => {
    if (!trackEl || !hasOverflow) {
      return;
    }

    const rect = trackEl.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }

    const layout = resolveThumbLayout(rect.width);
    const localX = clamp(clientX - rect.left, 0, rect.width);
    const nextThumbLeft = clamp(localX - dragOffsetPx, 0, layout.travelPx);
    const ratio = layout.travelPx <= 0 ? 0 : nextThumbLeft / layout.travelPx;
    onScrollRequest(ratio * maxScrollLeft);
  };

  const handleTrackPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('.rack-header-scrollbar-thumb')) {
      return;
    }

    if (!hasOverflow) {
      return;
    }

    if (!trackEl) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    const trackRect = trackEl.getBoundingClientRect();
    const layout = resolveThumbLayout(trackRect.width);
    dragOffsetPx = layout.widthPx / 2;
    activePointerId = event.pointerId;
    trackEl.setPointerCapture(event.pointerId);
    requestCenteredScrollAtClientX(event.clientX);
  };

  const handleThumbPointerDown = (event: PointerEvent): void => {
    if (!hasOverflow) {
      return;
    }

    const thumbEl = event.currentTarget;
    if (!(thumbEl instanceof HTMLElement)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    activePointerId = event.pointerId;
    thumbEl.setPointerCapture(event.pointerId);
    const thumbRect = thumbEl.getBoundingClientRect();
    dragOffsetPx = clamp(event.clientX - thumbRect.left, 0, thumbRect.width);
    requestDragScrollAtClientX(event.clientX);
  };

  const clearActivePointer = (): void => {
    activePointerId = null;
  };

  const handleActivePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) {
      return;
    }

    event.preventDefault();
    requestDragScrollAtClientX(event.clientX);
  };

  const handleActivePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) {
      return;
    }
    clearActivePointer();
  };

  const handleActivePointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) {
      return;
    }
    clearActivePointer();
  };

  const handleActiveLostPointerCapture = (): void => {
    clearActivePointer();
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!hasOverflow) {
      return;
    }

    const pageStep = Math.max(metrics.clientWidth * PAGE_SCROLL_RATIO, KEYBOARD_SCROLL_STEP_PX);
    let nextScrollLeft: number;

    switch (event.key) {
      case 'ArrowLeft':
        nextScrollLeft = valueNow - KEYBOARD_SCROLL_STEP_PX;
        break;
      case 'ArrowRight':
        nextScrollLeft = valueNow + KEYBOARD_SCROLL_STEP_PX;
        break;
      case 'PageUp':
        nextScrollLeft = valueNow - pageStep;
        break;
      case 'PageDown':
        nextScrollLeft = valueNow + pageStep;
        break;
      case 'Home':
        nextScrollLeft = 0;
        break;
      case 'End':
        nextScrollLeft = maxScrollLeft;
        break;
      default:
        return;
    }

    event.preventDefault();
    onScrollRequest(clamp(nextScrollLeft, 0, maxScrollLeft));
  };

  onMount(() => () => {
    if (mirrorSyncFrameId !== null) {
      window.cancelAnimationFrame(mirrorSyncFrameId);
      mirrorSyncFrameId = null;
    }
  });

  $effect(() => {
    const signature = [
      controlsId,
      contentRevision.toString(),
      metrics.scrollWidth.toFixed(2),
      metrics.clientWidth.toFixed(2),
      occupiedSourceWidthPx.toFixed(2),
      naturalScaledWidthPx.toFixed(2),
      scrollbarWidthPx.toFixed(2),
    ].join('|');
    scheduleMirrorSync(signature);
  });
</script>

{#if hasRackContent}
  <div
    bind:this={trackEl}
    bind:clientWidth={trackWidthPx}
    bind:clientHeight={trackHeightPx}
    class="rack-header-scrollbar"
    role="scrollbar"
    aria-label="Rack minimap scrollbar"
    aria-orientation="horizontal"
    aria-controls={controlsId}
    aria-valuemin={0}
    aria-valuemax={Math.max(maxScrollLeft, 0)}
    aria-valuenow={Math.max(valueNow, 0)}
    aria-disabled={!hasOverflow}
    tabindex={hasOverflow ? 0 : -1}
    style={rootStyle}
    onpointerdown={handleTrackPointerDown}
    onpointermove={handleActivePointerMove}
    onpointerup={handleActivePointerUp}
    onpointercancel={handleActivePointerCancel}
    onlostpointercapture={handleActiveLostPointerCapture}
    onkeydown={handleKeyDown}
  >
    <div class="rack-header-scrollbar-minimap" aria-hidden="true">
      <div
        class="rack-header-scrollbar-minimap-mirror"
        style={mirrorStyle}
      >
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html mirrorMarkup}
      </div>
    </div>
    <button
      class="rack-header-scrollbar-thumb"
      type="button"
      aria-hidden="true"
      tabindex="-1"
      hidden={!hasOverflow}
      disabled={!hasOverflow}
      style={thumbStyle}
      onpointerdown={handleThumbPointerDown}
    ></button>
  </div>
{/if}

<style lang="scss">
  .rack-header-scrollbar {
    --scrollbar-track-border-color: var(--neutral-20);
    -webkit-app-region: no-drag;

    position: relative;
    height: 1.5rem;
    border-radius: var(--radius-4);

    &::after {
      content: '';
      position: absolute;
      inset: 0;
      border: 1px solid var(--scrollbar-track-border-color);
      border-radius: inherit;
    }

    &-minimap {
      position: absolute;
      inset: var(--gap-4);
      pointer-events: none;
      overflow: hidden;
    }

    &-thumb {
      position: absolute;
      top: 0;
      bottom: 0;
      border: 1px solid var(--neutral-40);
      background: transparent;
      border-radius: var(--radius-4);
      z-index: 1;
    }

    &:focus-visible {
      --scrollbar-track-border-color: var(--accent-500);
    }
  }
</style>
