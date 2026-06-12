<svelte:options runes={true} />

<script lang="ts">
  import type { EditorHistoryListEntry } from '../../features/editor/editor-history';
  import FloatingDropdown from '../primitives/FloatingDropdown.svelte';
  import DropdownOptionList from '../primitives/DropdownOptionList.svelte';
  import type { DropdownOption, DropdownValue } from '../primitives/dropdown-types';

  const timestampFormatter = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
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

  const displayItems = $derived.by(() => [...items].reverse());
  const currentItem = $derived.by(() => displayItems.find((item) => item.isCurrent) ?? null);
  const options = $derived.by((): DropdownOption[] =>
    displayItems.map((item) => ({
      value: item.id,
      label: item.label,
      meta: timestampFormatter.format(new Date(item.createdAt)),
      disabled: item.isCurrent,
    })));

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
    ariaLabel="Undo history"
    class="undo-history-list"
    onSelect={handleSelect}
    onClose={() => closeDropdown(true)}
  />
</FloatingDropdown>

<style lang="scss">
  :global(.undo-history-dropdown .undo-history-list .dropdown-option.is-disabled) {
    color: var(--neutral-90);
  }

  :global(.undo-history-dropdown .undo-history-list .dropdown-option-main) {
    flex: 1 1 auto;
    width: 100%;
    gap: var(--gap-16);
  }
</style>
