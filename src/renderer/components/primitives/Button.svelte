<svelte:options runes={true} />

<script lang="ts">
  import { hint } from '../overlays/hint';
  import { buttonPress } from './button-press.svelte';

  type ButtonVariant = 'secondary' | 'primary' | 'icon';
  type ButtonType = 'button' | 'submit' | 'reset';

  let {
    id,
    variant = 'secondary',
    text,
    icon,
    label,
    pressed,
    disabled = false,
    class: className = '',
    type = 'button',
    title,
    onClick,
    ...rest
  } = $props<{
    id?: string;
    variant?: ButtonVariant;
    text?: string;
    icon?: string;
    label?: string;
    pressed?: boolean;
    disabled?: boolean;
    class?: string;
    type?: ButtonType;
    title?: string;
    onClick?: (event: MouseEvent) => void;
  } & Record<string, unknown>>();

  const isIconButton = $derived(variant === 'icon');
  const buttonClass = $derived(`button button-${variant} ${className}`.trim());
  const ariaLabel = $derived(label ?? text ?? (isIconButton ? icon : undefined));
  const visibleText = $derived(text ?? label ?? '');
  const hintText = $derived(title ?? (isIconButton ? ariaLabel : undefined));
</script>

<button
  {...rest}
  {id}
  class={buttonClass}
  class:is-active={pressed === true}
  {type}
  aria-label={ariaLabel}
  aria-pressed={pressed}
  {disabled}
  use:hint={hintText}
  use:buttonPress
  onclick={onClick}
>
  {#if isIconButton}
    <span class="material-symbols-rounded" aria-hidden="true">{icon}</span>
  {:else}
    {visibleText}
  {/if}
</button>

<style lang="scss">
  .button {
    --button-disabled-color: color-mix(in oklch, var(--color-text-primary) 60%, transparent);

    border: 0;
    border-radius: var(--radius-6);
    background: var(--color-surface-interactive);
    color: var(--color-text-primary);
    padding: var(--gap-6) var(--gap-8);
    font-size: var(--text-13);
    white-space: nowrap;
    transition:
      background-color 80ms linear,
      color 80ms linear;

    &:disabled {
      color: var(--button-disabled-color);
    }

    &-primary {
      --button-disabled-color: color-mix(in oklch, var(--color-text-inverse) 60%, transparent);

      background: var(--color-surface-inverse);
      color: var(--color-text-inverse);
    }

    &-icon {
      width: 2rem;
      height: 2rem;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;

      .material-symbols-rounded {
        font-size: var(--text-18);
        line-height: 1;
        font-variation-settings: 'FILL' 1, 'wght' 400;
      }
    }

    &:not(:disabled):not(.button-primary):not(.is-active):hover {
      background: var(--color-surface-active);
      color: var(--color-text-primary);
    }

    &.is-active {
      background: var(--color-surface-inverse);
      color: var(--color-text-inverse);
    }
  }
</style>
