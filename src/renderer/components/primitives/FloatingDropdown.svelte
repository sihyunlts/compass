<svelte:options runes={true} />

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Spring } from 'svelte/motion';
  import type { Snippet } from 'svelte';
  import {
    attachFloatingLayerDismissHandlers,
    DEFAULT_FLOATING_LAYER_MARGIN_PX,
    FLOATING_LAYER_ENTER_SPRING_OPTIONS,
    isEventTargetWithinFloatingLayer,
    resolveAnchoredFloatingLayerPosition,
    resolveFloatingLayerEnterOffsetY,
    resolveViewportFloatingLayerPosition,
  } from '../overlays/floating-layer';
  import { FloatingLayerPresence } from '../overlays/floating-layer-presence.svelte';
  import {
    activateFloatingLayer,
    createFloatingLayerId,
    deactivateFloatingLayer,
    resolveFloatingLayerParentId,
  } from '../overlays/floating-layer-stack';

  let {
    open = false,
    anchorEl = null,
    anchorPoint = null,
    class: className = '',
    onClose,
    children,
  } = $props<{
    open?: boolean;
    anchorEl?: HTMLElement | null;
    anchorPoint?: { x: number; y: number } | null;
    class?: string;
    onClose: (restoreFocus: boolean) => void;
    children?: Snippet;
  }>();

  let dropdownEl = $state<HTMLDivElement | null>(null);
  let x = $state(0);
  let y = $state(0);
  let maxHeightPx = $state(384);
  let isPositioned = $state(false);
  let positionToken = 0;
  let floatingLayerStackOrder = $state(1);
  const floatingLayerId = createFloatingLayerId('floating-dropdown');
  let hasOpenDescendant = $state(false);
  const isLayerOpen = $derived(
    open || hasOpenDescendant,
  );

  const rootClass = $derived(`floating-dropdown floating-menu-surface ${className}`.trim());
  const presence = new FloatingLayerPresence();
  const enterY = new Spring(0, FLOATING_LAYER_ENTER_SPRING_OPTIONS);

  const updatePosition = async (): Promise<void> => {
    const token = ++positionToken;
    await tick();

    if (
      !isLayerOpen
      || token !== positionToken
      || !dropdownEl
      || (!anchorEl && !anchorPoint)
    ) {
      return;
    }

    if (!anchorEl && anchorPoint) {
      const pointPosition = resolveViewportFloatingLayerPosition(
        anchorPoint.x,
        anchorPoint.y,
        {
          width: dropdownEl.offsetWidth,
          height: dropdownEl.offsetHeight,
        },
      );
      x = pointPosition.x;
      y = pointPosition.y;
      maxHeightPx = Math.max(
        0,
        window.innerHeight - DEFAULT_FLOATING_LAYER_MARGIN_PX * 2,
      );
      void enterY.set(0, { instant: true });
      isPositioned = true;
      return;
    }

    if (!anchorEl) {
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
    const shouldStartEnterMotion = !isPositioned;
    if (shouldStartEnterMotion) {
      void enterY.set(
        resolveFloatingLayerEnterOffsetY(nextPosition.verticalPlacement),
        { instant: true },
      );
      isPositioned = true;
      presence.enter([{ element: dropdownEl }]);
      enterY.target = 0;
      return;
    }

    isPositioned = true;
  };

  $effect(() => {
    if (isLayerOpen && (anchorEl || anchorPoint)) {
      const anchorTarget = anchorEl
        ?? document.elementFromPoint(anchorPoint?.x ?? 0, anchorPoint?.y ?? 0);
      activateFloatingLayer({
        id: floatingLayerId,
        parentId: resolveFloatingLayerParentId(anchorTarget, floatingLayerId),
        containsEventTarget: (eventTarget) =>
          isEventTargetWithinFloatingLayer(eventTarget, dropdownEl)
          || isEventTargetWithinFloatingLayer(eventTarget, anchorEl),
        onDismissRequest: () => onClose(false),
        onEscapeRequest: () => onClose(true),
        onDescendantStateChange: (hasActiveDescendant) => {
          hasOpenDescendant = hasActiveDescendant;
        },
        onStackOrderChange: (stackOrder) => {
          floatingLayerStackOrder = stackOrder;
        },
      });
      presence.show();
      void updatePosition();
      return;
    }

    if (!presence.rendered || presence.exiting) {
      return;
    }

    if (!dropdownEl || !isPositioned) {
      presence.hideImmediately();
      deactivateFloatingLayer(floatingLayerId);
      isPositioned = false;
      void enterY.set(0, { instant: true });
      return;
    }

    presence.hide([{ element: dropdownEl }], () => {
      deactivateFloatingLayer(floatingLayerId);
      isPositioned = false;
      void enterY.set(0, { instant: true });
    });
  });

  onMount(() => {
    const detachDismissHandlers = attachFloatingLayerDismissHandlers({
      layerId: floatingLayerId,
      isActive: () => isLayerOpen,
      containsEventTarget: (eventTarget) =>
        isEventTargetWithinFloatingLayer(eventTarget, dropdownEl)
        || isEventTargetWithinFloatingLayer(eventTarget, anchorEl),
      onPointerDownOutside: () => onClose(false),
      onResize: () => {
        void updatePosition();
      },
      onDismissRequest: () => onClose(false),
    });

    return () => {
      deactivateFloatingLayer(floatingLayerId);
      presence.destroy();
      detachDismissHandlers();
    };
  });
</script>

{#if presence.rendered}
  <div
    bind:this={dropdownEl}
    class={rootClass}
    class:is-positioned={isPositioned}
    aria-hidden={!isLayerOpen || !isPositioned}
    style:transform={`translate3d(${x}px, ${y}px, 0)`}
    style:--floating-dropdown-max-height={`${maxHeightPx}px`}
    style:--floating-dropdown-enter-y={`${enterY.current}px`}
    style:--floating-layer-stack-order={floatingLayerStackOrder}
  >
    {#if children}
      {@render children()}
    {/if}
  </div>
{/if}

<style lang="scss">
  .floating-dropdown {
    max-height: min(24rem, var(--floating-dropdown-max-height, calc(100vh - 1rem)));
    overflow-y: auto;
    visibility: hidden;
    translate: 0 var(--floating-dropdown-enter-y, 0);
    pointer-events: none;

    &.is-positioned {
      visibility: visible;
      pointer-events: auto;
    }
  }
</style>
