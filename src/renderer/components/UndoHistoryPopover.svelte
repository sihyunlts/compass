<svelte:options runes={true} />

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { EditorHistoryListEntry } from '../features/editor/editor-history';
  import {
    attachFloatingLayerDismissHandlers,
    isEventTargetWithinFloatingLayer,
    resolveViewportFloatingLayerPosition,
  } from '../features/rack/floating-layer';

  const timestampFormatter = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  let {
    open = false,
    anchorEl = null,
    triggerEl = null,
    items,
    onSelect,
    onClose,
  } = $props<{
    open?: boolean;
    anchorEl?: HTMLElement | null;
    triggerEl?: HTMLElement | null;
    items: EditorHistoryListEntry[];
    onSelect: (id: string) => void;
    onClose: () => void;
  }>();

  let popoverEl = $state<HTMLDivElement | null>(null);
  let x = $state(0);
  let y = $state(0);
  let positionToken = 0;

  const displayItems = $derived.by(() => [...items].reverse());
  const currentItemIndex = $derived.by(() =>
    displayItems.findIndex((item) => item.isCurrent));

  const resolveItemButtons = (): HTMLButtonElement[] =>
    popoverEl
      ? [...popoverEl.querySelectorAll<HTMLButtonElement>('.undo-history-item')]
      : [];

  const findEnabledItemIndex = (
    startIndex: number,
    direction: 1 | -1,
  ): number => {
    for (
      let index = startIndex;
      index >= 0 && index < displayItems.length;
      index += direction
    ) {
      if (!displayItems[index]?.isCurrent) {
        return index;
      }
    }

    return -1;
  };

  const focusItemAt = (index: number): void => {
    if (index < 0) {
      return;
    }

    const nextButton = resolveItemButtons()[index];
    nextButton?.focus();
  };

  const focusInitialItem = (): void => {
    const nextEnabledIndex = currentItemIndex >= 0
      ? findEnabledItemIndex(currentItemIndex + 1, 1)
      : -1;
    const previousEnabledIndex = currentItemIndex >= 0
      ? findEnabledItemIndex(currentItemIndex - 1, -1)
      : -1;

    focusItemAt(nextEnabledIndex >= 0 ? nextEnabledIndex : previousEnabledIndex);
  };

  const formatTimestamp = (timestampMs: number): string =>
    timestampFormatter.format(new Date(timestampMs));

  const closePopover = (restoreFocus: boolean): void => {
    onClose();
    if (restoreFocus) {
      triggerEl?.focus();
    }
  };

  const handleSelect = (id: string, isCurrent: boolean): void => {
    if (!isCurrent) {
      onSelect(id);
    }

    closePopover(true);
  };

  const handleItemKeyDown = (
    event: KeyboardEvent,
    index: number,
    id: string,
    isCurrent: boolean,
  ): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePopover(true);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItemAt(findEnabledItemIndex(index + 1, 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItemAt(findEnabledItemIndex(index - 1, -1));
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      focusItemAt(findEnabledItemIndex(0, 1));
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      focusItemAt(findEnabledItemIndex(displayItems.length - 1, -1));
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelect(id, isCurrent);
    }
  };

  const updatePosition = async (): Promise<void> => {
    const token = ++positionToken;
    await tick();

    if (!open || token !== positionToken || !popoverEl || !anchorEl) {
      return;
    }

    const anchorRect = anchorEl.getBoundingClientRect();
    const nextPosition = resolveViewportFloatingLayerPosition(
      anchorRect.left,
      anchorRect.bottom + 8,
      {
        width: popoverEl.offsetWidth,
        height: popoverEl.offsetHeight,
      },
    );
    x = nextPosition.x;
    y = nextPosition.y;
    focusInitialItem();
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
      isEventTargetWithinFloatingLayer(eventTarget, popoverEl)
      || isEventTargetWithinFloatingLayer(eventTarget, anchorEl),
    onPointerDownOutside: () => {
      closePopover(false);
    },
    onResize: () => {
      void updatePosition();
    },
  }));
</script>

{#if open}
  <div
    bind:this={popoverEl}
    class="undo-history-popover"
    role="dialog"
    aria-label="Undo history"
    style:transform={`translate3d(${x}px, ${y}px, 0)`}
  >
    <div class="undo-history-list" role="list">
      {#each displayItems as item, index (item.id)}
        <button
          type="button"
          class="undo-history-item"
          data-current={item.isCurrent}
          aria-current={item.isCurrent ? 'step' : undefined}
          aria-disabled={item.isCurrent ? 'true' : undefined}
          tabindex={item.isCurrent ? -1 : undefined}
          onclick={() => handleSelect(item.id, item.isCurrent)}
          onkeydown={(event) => handleItemKeyDown(event, index, item.id, item.isCurrent)}
        >
          <span class="undo-history-item-main">
            <span class="undo-history-item-label">{item.label}</span>
            <span class="undo-history-item-meta">{formatTimestamp(item.createdAt)}</span>
          </span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style lang="scss">
  .undo-history-popover {
    position: fixed;
    inset: 0 auto auto 0;
    z-index: 44;
    width: min(15rem, calc(100vw - 1rem));
    max-height: min(24rem, calc(100vh - 1rem));
    padding: var(--gap-4);
    border: 1px solid var(--neutral-30);
    border-radius: var(--radius-8);
    background: var(--neutral-10);
  }

  .undo-history-list {
    overflow-y: auto;
  }

  .undo-history-item {
    width: 100%;
    padding: var(--gap-6) var(--gap-8);
    border: 0;
    border-radius: var(--radius-4);
    background: transparent;
    color: var(--neutral-90);
    text-align: left;
    cursor: pointer;

    &[aria-disabled='true'] {
      cursor: default;
    }

    &:hover,
    &:focus-visible {
      background: var(--neutral-20);
      outline: none;
    }

    &[data-current='true'] {
      background: color-mix(in srgb, var(--accent-500) 14%, var(--neutral-20));
    }

    &-main {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--gap-8);
      min-width: 0;
    }

    &-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &-meta {
      color: var(--neutral-60);
      font-size: var(--text-12);
      flex: 0 0 auto;
    }
  }
</style>
