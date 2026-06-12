<svelte:options runes={true} />

<script lang="ts">
  import type { EditorHistoryListEntry } from '../../features/editor/editor-history';
  import SplitButton from '../primitives/SplitButton.svelte';
  import UndoHistoryDropdown from './UndoHistoryDropdown.svelte';

  let {
    canUndo,
    undoActionLabel,
    historyEntries,
    onUndo,
    onCheckout,
  } = $props<{
    canUndo: boolean;
    undoActionLabel: string;
    historyEntries: EditorHistoryListEntry[];
    onUndo: () => void;
    onCheckout: (id: string) => void;
  }>();

  let rootEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let isOpen = $state(false);
  const canCheckoutHistory = $derived.by(() =>
    historyEntries.some((entry: EditorHistoryListEntry) => !entry.isCurrent));

  const handleUndoClick = (): void => {
    isOpen = false;
    onUndo();
  };

  const handleTriggerClick = (): void => {
    isOpen = !isOpen;
  };

  const closePopover = (): void => {
    isOpen = false;
  };
</script>

<div bind:this={rootEl} class="undo-history-control">
  <SplitButton
    id="undo-button"
    text="Undo"
    disabled={!canUndo}
    title={canUndo ? `Undo: ${undoActionLabel}` : 'Nothing to undo'}
    label={canUndo ? `Undo: ${undoActionLabel}` : 'Undo unavailable'}
    menuId="undo-history-trigger"
    menuDisabled={!canCheckoutHistory}
    menuLabel="Show undo history"
    menuTitle="Show undo history"
    menuExpanded={isOpen}
    menuPopupType="dialog"
    onClick={handleUndoClick}
    onMenuClick={(event) => {
      triggerEl = event.currentTarget as HTMLButtonElement;
      handleTriggerClick();
    }}
  />

  <UndoHistoryDropdown
    open={isOpen}
    anchorEl={rootEl}
    triggerEl={triggerEl}
    items={historyEntries}
    onSelect={onCheckout}
    onClose={closePopover}
  />
</div>

<style lang="scss">
  .undo-history-control {
    display: inline-flex;
  }
</style>
