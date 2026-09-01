<svelte:options runes={true} />

<script lang="ts">
  import type { EditorHistoryListEntry } from '../../features/editor/editor-history';
  import type { ChainHistoryKind } from '../../features/editor/history-core';
  import { resolveHistoryActionLabel } from '../../features/editor/history-i18n';
  import type { ShortcutPresentation } from '../../../shared/keyboard-shortcuts';
  import SplitButton from '../primitives/SplitButton.svelte';
  import UndoHistoryDropdown from './UndoHistoryDropdown.svelte';
  import { i18n } from '../../i18n.svelte';

  let {
    canUndo,
    undoActionKind,
    historyEntries,
    shortcut,
    onUndo,
    onCheckout,
  } = $props<{
    canUndo: boolean;
    undoActionKind: ChainHistoryKind | null;
    historyEntries: EditorHistoryListEntry[];
    shortcut: ShortcutPresentation;
    onUndo: () => void;
    onCheckout: (id: string) => void;
  }>();

  let rootEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let isOpen = $state(false);
  const canCheckoutHistory = $derived.by(() =>
    historyEntries.some((entry: EditorHistoryListEntry) => !entry.isCurrent));
  const localizedUndoActionLabel = $derived(
    undoActionKind ? resolveHistoryActionLabel(undoActionKind) : '',
  );

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
    text={i18n.t('history.undo')}
    disabled={!canUndo}
    title={canUndo
      ? i18n.t('history.undoAction', { action: localizedUndoActionLabel })
      : i18n.t('history.nothingToUndo')}
    label={canUndo
      ? i18n.t('history.undoAction', { action: localizedUndoActionLabel })
      : i18n.t('history.undoUnavailable')}
    {shortcut}
    menuId="undo-history-trigger"
    menuDisabled={!canCheckoutHistory}
    menuLabel={i18n.t('history.showUndoHistory')}
    menuTitle={i18n.t('history.showUndoHistory')}
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
