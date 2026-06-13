<svelte:options runes={true} />

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Snippet } from 'svelte';
  import {
    attachFloatingLayerDismissHandlers,
    isEventTargetWithinFloatingLayer,
    resolveAnchoredFloatingLayerPosition,
  } from '../overlays/floating-layer';

  let {
    open = false,
    anchorEl = null,
    class: className = '',
    onClose,
    children,
  } = $props<{
    open?: boolean;
    anchorEl?: HTMLElement | null;
    class?: string;
    onClose: (restoreFocus: boolean) => void;
    children?: Snippet;
  }>();

  let dropdownEl = $state<HTMLDivElement | null>(null);
  let x = $state(0);
  let y = $state(0);
  let maxHeightPx = $state(384);
  let positionToken = 0;

  const rootClass = $derived(`floating-dropdown floating-menu-surface ${className}`.trim());

  const updatePosition = async (): Promise<void> => {
    const token = ++positionToken;
    await tick();

    if (!open || token !== positionToken || !dropdownEl || !anchorEl) {
      return;
    }

    const anchorRect = anchorEl.getBoundingClientRect();
    const nextPosition = resolveAnchoredFloatingLayerPosition(anchorRect, {
      width: dropdownEl.offsetWidth,
      height: dropdownEl.offsetHeight,
    }, {
      gapPx: 4,
    });

    x = nextPosition.x;
    y = nextPosition.y;
    maxHeightPx = nextPosition.maxHeight;
  };

  $effect(() => {
    if (!open || !anchorEl) {
      return;
    }

    void updatePosition();
  });

  onMount(() => attachFloatingLayerDismissHandlers({
    isActive: () => open,
    containsEventTarget: (eventTarget) =>
      isEventTargetWithinFloatingLayer(eventTarget, dropdownEl)
      || isEventTargetWithinFloatingLayer(eventTarget, anchorEl),
    onPointerDownOutside: () => onClose(false),
    onResize: () => {
      void updatePosition();
    },
    onDismissRequest: () => onClose(false),
  }));
</script>

{#if open}
  <div
    bind:this={dropdownEl}
    class={rootClass}
    style:transform={`translate3d(${x}px, ${y}px, 0)`}
    style:--floating-dropdown-max-height={`${maxHeightPx}px`}
  >
    {#if children}
      {@render children()}
    {/if}
  </div>
{/if}

<style lang="scss">
  .floating-dropdown {
    z-index: 44;
    max-height: min(24rem, var(--floating-dropdown-max-height, calc(100vh - 1rem)));
    overflow-y: auto;
  }
</style>
