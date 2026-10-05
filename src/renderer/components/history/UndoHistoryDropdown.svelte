<svelte:options runes={true} />

<script lang="ts">
  import type { EditorHistoryListEntry } from '../../features/editor/editor-history';
  import FloatingDropdown from '../primitives/FloatingDropdown.svelte';
  import DropdownOptionList from '../primitives/DropdownOptionList.svelte';
  import type { DropdownOption, DropdownValue } from '../primitives/dropdown-types';
  import { i18n } from '../../i18n.svelte';
  import { resolveHistoryActionPresentation } from '../../features/editor/history-i18n';

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

  const timestampFormatter = $derived.by(() => new Intl.DateTimeFormat(i18n.locale, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }));
  const displayItems = $derived.by(() => [...items].reverse());
  const currentItem = $derived.by(() => displayItems.find((item) => item.isCurrent) ?? null);
  type HistoryOption = DropdownOption & {
    parts: ReturnType<typeof resolveHistoryActionPresentation>;
  };
  const options = $derived.by((): HistoryOption[] =>
    displayItems.map((item) => {
      const parts = resolveHistoryActionPresentation(item);
      return {
        value: item.id,
        label: parts.label,
        parts,
        meta: timestampFormatter.format(new Date(item.createdAt)),
        disabled: item.isCurrent,
      };
    }));

  const closeDropdown = (restoreFocus: boolean): void => {
    onClose();
    if (restoreFocus) {
      triggerEl?.focus();
    }
  };

  const handleSelect = (value: DropdownValue): void => {
    const id = String(value);
    if (id !== currentItem?.id) {
      onSelect(id);
    }
    closeDropdown(true);
  };
</script>

<FloatingDropdown
  {open}
  {anchorEl}
  class="undo-history-dropdown"
  onClose={closeDropdown}
>
  <DropdownOptionList
    {options}
    value={currentItem?.id ?? null}
    ariaLabel={i18n.t('history.undoAria')}
    class="undo-history-list"
    onSelect={handleSelect}
    onClose={() => closeDropdown(true)}
  >
    {#snippet optionLabel(option)}
      {#if option.parts.beforeTarget.trim()}
        <span class="history-edit-label">{option.parts.beforeTarget.trim()}</span>
      {/if}
      {#if option.parts.targetName}
        <span class="history-target-name">{option.parts.targetName}</span>
      {/if}
      {#if option.parts.additionalTargets}
        <span class="history-edit-label">{option.parts.additionalTargets}</span>
      {/if}
      {#if option.parts.afterTarget.trim()}
        <span class="history-edit-label">{option.parts.afterTarget.trim()}</span>
      {/if}
    {/snippet}
  </DropdownOptionList>
</FloatingDropdown>

<style lang="scss">
  :global(.undo-history-dropdown .undo-history-list .dropdown-option.is-disabled) {
    color: var(--color-text-primary);
  }

  :global(.undo-history-dropdown .undo-history-list .dropdown-option-main) {
    flex: 1 1 auto;
    width: 100%;
    gap: var(--gap-16);
  }

  :global(.undo-history-dropdown .undo-history-list .dropdown-option-label) {
    display: flex;
    gap: 0.25em;
    overflow: visible;
    text-overflow: clip;
  }

  .history-target-name {
    min-width: 0;
    max-width: 8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-edit-label {
    flex: 0 0 auto;
    white-space: nowrap;
  }
</style>
