<svelte:options runes={true} />

<script lang="ts">
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
</script>

<button
  {...rest}
  {id}
  class={buttonClass}
  class:is-active={isIconButton && pressed === true}
  {type}
  aria-label={ariaLabel}
  aria-pressed={pressed}
  {disabled}
  {title}
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
    border: 0;
    border-radius: var(--radius-6);
    background: var(--neutral-20);
    color: var(--neutral-90);
    padding: var(--gap-6) var(--gap-8);
    font-size: var(--text-13);
    cursor: pointer;
    white-space: nowrap;

    &-primary {
      background: var(--accent-500);
      color: var(--accent-050);
    }

    &-icon {
      width: 2rem;
      height: 2rem;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;

      &.is-active {
        background: var(--accent-500);
        color: var(--accent-050);
      }

      .material-symbols-rounded {
        font-size: var(--text-18);
        line-height: 1;
        font-variation-settings: 'FILL' 1, 'wght' 400;
      }
    }
  }
</style>
