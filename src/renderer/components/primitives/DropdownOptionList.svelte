<svelte:options runes={true} />

<script lang="ts">
  import { tick } from 'svelte';
  import type { DropdownOption, DropdownValue } from './dropdown-types';

  let {
    options,
    value = null,
    ariaLabel,
    class: className = '',
    onSelect,
    onClose,
  } = $props<{
    options: readonly DropdownOption[];
    value?: DropdownValue | null;
    ariaLabel: string;
    class?: string;
    onSelect: (value: DropdownValue) => void;
    onClose: () => void;
  }>();

  let rootEl = $state<HTMLDivElement | null>(null);
  let activeIndex = $state(-1);

  const rootClass = $derived(`dropdown-option-list floating-menu-list ${className}`.trim());

  const isSelected = (option: DropdownOption): boolean =>
    value !== null && String(option.value) === String(value);

  const findEnabledIndex = (startIndex: number, direction: 1 | -1): number => {
    for (
      let index = startIndex;
      index >= 0 && index < options.length;
      index += direction
    ) {
      if (!options[index]?.disabled) {
        return index;
      }
    }
    return -1;
  };

  const resolveInitialIndex = (): number => {
    const selectedIndex = options.findIndex((option) => isSelected(option) && !option.disabled);
    return selectedIndex >= 0 ? selectedIndex : findEnabledIndex(0, 1);
  };

  const focusOption = (index: number): void => {
    activeIndex = index;
    if (index < 0) {
      return;
    }
    void tick().then(() => {
      rootEl?.querySelector<HTMLElement>(`[data-dropdown-option-index="${index}"]`)?.focus();
    });
  };

  const selectOption = (index: number): void => {
    const option = options[index];
    if (!option || option.disabled) {
      return;
    }
    onSelect(option.value);
  };

  const handleKeyDown = (event: KeyboardEvent, index: number): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(findEnabledIndex(index + 1, 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(findEnabledIndex(index - 1, -1));
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      focusOption(findEnabledIndex(0, 1));
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      focusOption(findEnabledIndex(options.length - 1, -1));
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectOption(index);
    }
  };

  $effect(() => {
    void options;
    void value;
    focusOption(resolveInitialIndex());
  });
</script>

<div
  bind:this={rootEl}
  class={rootClass}
  role="listbox"
  aria-label={ariaLabel}
>
  {#each options as option, index (`${option.value}`)}
    {@const selected = isSelected(option)}
    <div
      class="dropdown-option floating-menu-item"
      class:is-selected={selected}
      class:is-disabled={option.disabled}
      role="option"
      aria-selected={selected ? 'true' : 'false'}
      aria-disabled={option.disabled ? 'true' : undefined}
      tabindex={option.disabled ? -1 : (activeIndex === index ? 0 : -1)}
      data-dropdown-option-index={index}
      onfocus={() => activeIndex = index}
      onclick={() => selectOption(index)}
      onkeydown={(event) => handleKeyDown(event, index)}
    >
      <span class="dropdown-option-check material-symbols-rounded" aria-hidden="true">
        {selected ? 'check' : ''}
      </span>
      <span class="dropdown-option-main">
        <span class="dropdown-option-label">{option.label}</span>
        {#if option.meta}
          <span class="dropdown-option-meta">{option.meta}</span>
        {/if}
      </span>
    </div>
  {/each}
</div>

<style lang="scss">
  .dropdown-option-list {
    min-width: 0;
  }

  .dropdown-option {
    display: flex;
    align-items: center;
    gap: var(--gap-6);
    width: 100%;
    padding-left: var(--gap-4);

    &.is-selected:focus-visible {
      background: transparent;
    }

    &.is-selected:hover {
      background: var(--neutral-20);
    }

    &.is-disabled {
      cursor: default;
      color: var(--neutral-50);
    }
  }

  .dropdown-option-check {
    flex: 0 0 var(--text-16);
    width: var(--text-16);
    color: var(--neutral-90);
    font-size: var(--text-16);
    line-height: 1;
    font-variation-settings: 'FILL' 0, 'wght' 600;
  }

  .dropdown-option-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-8);
    min-width: 0;
  }

  .dropdown-option-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dropdown-option-meta {
    color: var(--neutral-50);
    font-size: var(--text-12);
    flex: 0 0 auto;
  }
</style>
