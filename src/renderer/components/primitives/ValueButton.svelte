<svelte:options runes={true} />

<script lang="ts">
  import { hint } from '../overlays/hint';

  let {
    text,
    label,
    placeholder,
    pressed = false,
    outlinePulse = false,
    disabled = false,
    class: className = '',
    clearLabel,
    clearTitle,
    onPointerDown,
    onClick,
    onClear,
  } = $props<{
    text: string;
    label: string;
    placeholder?: string;
    pressed?: boolean;
    outlinePulse?: boolean;
    disabled?: boolean;
    class?: string;
    clearLabel?: string;
    clearTitle?: string;
    onPointerDown?: (event: PointerEvent) => void;
    onClick?: (event: MouseEvent) => void;
    onClear?: (event: MouseEvent) => void;
  }>();

  const visibleText = $derived(text || placeholder || '');
  const rootClass = $derived(`value-button ${className}`.trim());
  const hasClearAction = $derived(typeof onClear === 'function');
  const isDisabled = $derived(disabled === true);
  const clearHint = $derived(clearTitle ?? clearLabel ?? 'Clear value');

  const handleClearPointerDown = (event: PointerEvent): void => {
    event.stopPropagation();
  };

  const handleClearClick = (event: MouseEvent): void => {
    event.stopPropagation();
    onClear?.(event);
  };
</script>

<div
  class={rootClass}
  class:is-active={pressed}
  class:is-outline-pulsing={outlinePulse}
  class:is-placeholder={!text && !!placeholder}
  class:is-disabled={isDisabled}
  class:has-clear={hasClearAction}
>
  <button
    type="button"
    class="value-button-action"
    aria-label={label}
    aria-pressed={pressed}
    disabled={isDisabled}
    onpointerdown={onPointerDown}
    onclick={onClick}
  >
    <span class="value-button-text">{visibleText}</span>
  </button>
  {#if hasClearAction}
    <button
      type="button"
      class="value-button-clear"
      aria-label={clearLabel ?? 'Clear value'}
      use:hint={clearHint}
      disabled={isDisabled}
      onpointerdown={handleClearPointerDown}
      onclick={handleClearClick}
    >
      <span class="material-symbols-rounded" aria-hidden="true">close</span>
    </button>
  {/if}
</div>

<style lang="scss">
  .value-button {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    height: var(--gap-20);
    min-width: 0;
    min-height: 0;
    border-radius: var(--radius-4);
    background: var(--color-surface-interactive);
    color: var(--color-text-primary);
    font-size: var(--text-12);
    line-height: normal;
    outline: 1px solid transparent;
    outline-offset: -1px;
    text-align: left;

    &.is-placeholder {
      color: var(--color-text-secondary);
    }

    &.is-active {
      background: var(--color-surface-active);
      color: var(--color-text-primary);
    }

    &.is-outline-pulsing {
      outline-color: var(--device-control-accent);
      animation: value-button-capture-outline-pulse 900ms ease-in-out infinite;
    }

    &.is-disabled {
      color: color-mix(in oklch, var(--color-text-primary) 60%, transparent);
    }

    &.has-clear .value-button-action {
      padding-right: var(--gap-20);
    }
  }

  .value-button-action {
    border: 0;
    display: flex;
    align-items: center;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    border-radius: inherit;
    padding: 0 var(--gap-6);
    background: transparent;
    color: inherit;
    font: inherit;
    line-height: inherit;
    text-align: inherit;
    cursor: pointer;

    &:disabled {
      cursor: default;
    }
  }

  .value-button-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value-button-clear {
    position: absolute;
    top: 50%;
    right: var(--gap-2);
    border: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    min-width: 0;
    min-height: 0;
    padding: 0;
    transform: translateY(-50%);
    border-radius: var(--radius-2);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;

    &:hover {
      background: var(--color-surface-active);
      color: var(--color-text-primary);
    }

    &:disabled {
      cursor: default;
    }

    .material-symbols-rounded {
      font-size: var(--text-12);
      line-height: 1;
      font-variation-settings: 'FILL' 1, 'wght' 400;
    }
  }

  @keyframes value-button-capture-outline-pulse {
    0%,
    100% {
      outline-color: var(--device-control-accent);
    }

    50% {
      outline-color: transparent;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .value-button.is-outline-pulsing {
      animation: none;
      outline-color: var(--device-control-accent);
    }
  }
</style>
