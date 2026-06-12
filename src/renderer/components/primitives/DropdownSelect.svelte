<svelte:options runes={true} />

<script lang="ts">
  import FloatingDropdown from './FloatingDropdown.svelte';
  import DropdownOptionList from './DropdownOptionList.svelte';
  import type { DropdownOption, DropdownValue } from './dropdown-types';

  let {
    value,
    options,
    ariaLabel,
    disabled = false,
    class: className = '',
    onValueChange,
  } = $props<{
    value: DropdownValue;
    options: readonly DropdownOption[];
    ariaLabel: string;
    disabled?: boolean;
    class?: string;
    onValueChange: (value: DropdownValue) => void;
  }>();

  let rootEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let isOpen = $state(false);

  const selectedOption = $derived.by(() =>
    options.find((option) => String(option.value) === String(value)) ?? options[0] ?? null);
  const triggerText = $derived(selectedOption?.label ?? '');
  const hasEnabledOptions = $derived(options.some((option) => !option.disabled));
  const isDisabled = $derived(disabled || !hasEnabledOptions);
  const rootClass = $derived(`dropdown-select ${className}`.trim());

  const close = (restoreFocus: boolean): void => {
    isOpen = false;
    if (restoreFocus) {
      triggerEl?.focus();
    }
  };

  const handleSelect = (nextValue: DropdownValue): void => {
    onValueChange(nextValue);
    close(true);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }

    event.preventDefault();
    isOpen = true;
  };
</script>

<div bind:this={rootEl} class={rootClass}>
  <button
    bind:this={triggerEl}
    type="button"
    class="dropdown-select-trigger"
    aria-label={ariaLabel}
    aria-haspopup="listbox"
    aria-expanded={isOpen}
    disabled={isDisabled}
    onclick={() => isOpen = !isOpen}
    onkeydown={handleTriggerKeyDown}
  >
    <span class="dropdown-select-label">{triggerText}</span>
    <span class="material-symbols-rounded" aria-hidden="true">expand_more</span>
  </button>

  <FloatingDropdown
    open={isOpen}
    anchorEl={rootEl}
    onClose={close}
  >
    <DropdownOptionList
      {options}
      {value}
      ariaLabel={ariaLabel}
      onSelect={handleSelect}
      onClose={() => close(true)}
    />
  </FloatingDropdown>
</div>

<style lang="scss">
  .dropdown-select {
    display: inline-flex;
    min-width: 0;
    -webkit-app-region: no-drag;
  }

  .dropdown-select-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-6);
    min-width: 0;
    max-width: 100%;
    height: 1.75rem;
    padding: var(--gap-4) var(--gap-4) var(--gap-4) var(--gap-6);
    border: 0;
    border-radius: var(--radius-4);
    background: var(--neutral-20);
    color: var(--neutral-90);
    font-size: var(--text-13);
    cursor: pointer;

    &:focus-visible {
      box-shadow: inset 0 0 0 1px var(--neutral-30);
      outline: none;
    }

    &:disabled {
      cursor: default;
      opacity: 0.6;
    }

    &[aria-expanded='true'] {
      background: var(--neutral-30);
    }

    .material-symbols-rounded {
      flex: 0 0 auto;
      font-size: var(--text-18);
      line-height: 1;
      font-variation-settings: 'FILL' 1, 'wght' 400;
    }
  }

  .dropdown-select-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
