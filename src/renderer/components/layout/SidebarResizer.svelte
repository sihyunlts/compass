<script lang="ts">
  let {
    width = $bindable(),
    isResizing = $bindable(false),
    isBlocked = false,
    sanitizeWidth,
    onSave,
  } = $props<{
    width: number;
    isResizing?: boolean;
    isBlocked?: boolean;
    sanitizeWidth: (w: number) => number;
    onSave: (w: number) => void;
  }>();

  let pointerId = $state<number | null>(null);
  let startX = 0;
  let startWidth = 0;
  let resizerEl = $state<HTMLElement | null>(null);

  // Start resize mode and capture the initial pointer position.
  function handlePointerDown(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || pointerId !== null || isBlocked) {
      return;
    }

    const target = event.currentTarget as HTMLElement;
    resizerEl = target;
    pointerId = event.pointerId;
    startX = event.clientX;
    startWidth = width;
    isResizing = true;

    target.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  // Update sidebar width while pointer moves.
  function handlePointerMove(event: PointerEvent) {
    if (pointerId === null || pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - startX;
    width = sanitizeWidth(startWidth + deltaX);
  }

  // Save final width and stop resize mode on pointer up/cancel.
  function handlePointerUpOrCancel(event: PointerEvent) {
    if (pointerId === null || pointerId !== event.pointerId) {
      return;
    }

    if (event.type === 'pointerup') {
      onSave(width);
    }

    stopResizing();
  }

  // Release pointer capture and clear resize state.
  function stopResizing() {
    if (pointerId !== null && resizerEl && resizerEl.hasPointerCapture(pointerId)) {
      resizerEl.releasePointerCapture(pointerId);
    }

    pointerId = null;
    resizerEl = null;
    isResizing = false;
  }
</script>

<svelte:window
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUpOrCancel}
  onpointercancel={handlePointerUpOrCancel}
/>

<div
  id="sidebar-resizer"
  class="sidebar-resizer"
  class:is-active={isResizing}
  role="separator"
  aria-orientation="vertical"
  aria-label="Resize sidebar width"
  onpointerdown={handlePointerDown}
></div>

<style lang="scss">
  .sidebar-resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--sidebar-width, 240px);
    width: 12px;
    transform: translateX(-50%);
    z-index: 20;
    cursor: col-resize;
    -webkit-app-region: no-drag;
    touch-action: none;

    &::before {
      content: '';
      position: absolute;
      left: 50%;
      top: 0;
      bottom: 0;
      width: 1px;
      transform: translateX(-50%);
      transition: background-color 0.2s;
    }

    &:hover,
    &.is-active {
      &::before {
        background: var(--neutral-40);
      }
    }

    :global(#app.is-sidebar-resizing) & {
      &::before {
        background-color: var(--neutral-40);
      }
    }
  }
</style>
