<svelte:options runes={true} />

<script lang="ts">
  import { hint } from '../overlays/hint';
  import { buttonPress } from './button-press.svelte';
  import FloatingDropdown from './FloatingDropdown.svelte';
  import DropdownOptionList from './DropdownOptionList.svelte';
  import type { DropdownOption, DropdownValue } from './dropdown-types';

  let {
    value,
    options,
    ariaLabel,
    valueLabel,
    showHint = false,
    disabled = false,
    variant = 'default',
    icon,
    pressed,
    heading,
    class: className = '',
    onOpen,
    onValueChange,
    ...rest
  } = $props<{
    value: DropdownValue;
    options: readonly DropdownOption[];
    ariaLabel: string;
    valueLabel?: string;
    showHint?: boolean;
    disabled?: boolean;
    variant?: 'default' | 'icon';
    icon?: string;
    pressed?: boolean;
    heading?: string;
    class?: string;
    onOpen?: () => void | Promise<void>;
    onValueChange: (value: DropdownValue) => void;
  } & Record<string, unknown>>();

  let rootEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let isOpen = $state(false);

  const selectedOption = $derived.by(() =>
    options.find(
      (option: DropdownOption) => String(option.value) === String(value),
    ) ?? options[0] ?? null);
  const triggerText = $derived(valueLabel ?? selectedOption?.label ?? '');
  const hasEnabledOptions = $derived(
    options.some((option: DropdownOption) => !option.disabled),
  );
  const isDisabled = $derived(disabled || !hasEnabledOptions);
  const isIconTrigger = $derived(variant === 'icon');
  const rootClass = $derived(`dropdown-select ${className}`.trim());

  const open = (): void => {
    if (isOpen) {
      return;
    }
    isOpen = true;
    void onOpen?.();
  };

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
    open();
  };
</script>

<div bind:this={rootEl} class={rootClass}>
  <button
    {...rest}
    bind:this={triggerEl}
    type="button"
    class="dropdown-select-trigger"
    class:is-icon-trigger={isIconTrigger}
    class:is-active={pressed === true}
    aria-label={ariaLabel}
    aria-haspopup="listbox"
    aria-expanded={isOpen}
    aria-pressed={isIconTrigger ? pressed : undefined}
    disabled={isDisabled}
    use:hint={showHint ? ariaLabel : undefined}
    use:buttonPress
    onclick={() => isOpen ? close(false) : open()}
    onkeydown={handleTriggerKeyDown}
  >
    {#if !isIconTrigger}
      <span class="dropdown-select-label">{triggerText}</span>
    {/if}
    <span class="material-symbols-rounded" aria-hidden="true">
      {isIconTrigger ? icon : 'expand_more'}
    </span>
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
      {heading}
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
    border-radius: var(--dropdown-select-radius, var(--radius-4));
    background: var(--color-surface-interactive);
    color: var(--color-text-primary);
    font-size: var(--text-13);
    cursor: pointer;
    transition:
      background-color 80ms linear,
      color 80ms linear;

    &:focus-visible {
      outline: 1px solid var(--color-border-secondary);
      outline-offset: -1px;
    }

    &:disabled {
      cursor: default;
      opacity: 0.6;
    }

    &:not(:disabled):hover,
    &[aria-expanded='true'] {
      background: var(--color-surface-active);
    }

    .material-symbols-rounded {
      flex: 0 0 auto;
      font-size: var(--text-18);
      line-height: 1;
      font-variation-settings: 'FILL' 1, 'wght' 400;
    }

    &.is-icon-trigger {
      justify-content: center;
      width: 2rem;
      height: 2rem;
      padding: 0;
      border-radius: var(--radius-6);

      &.is-active {
        background: var(--color-surface-inverse);
        color: var(--color-text-inverse);
      }
    }
  }

  .dropdown-select-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
