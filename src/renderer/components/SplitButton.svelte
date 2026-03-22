<svelte:options runes={true} />

<script lang="ts">
  type SplitButtonVariant = 'secondary' | 'primary';
  type ButtonType = 'button' | 'submit' | 'reset';

  let {
    id,
    menuId,
    variant = 'secondary',
    text,
    label,
    title,
    disabled = false,
    menuDisabled = false,
    menuLabel,
    menuTitle,
    menuExpanded = false,
    menuPopupType = 'menu',
    type = 'button',
    onClick,
    onMenuClick,
    ...rest
  } = $props<{
    id?: string;
    menuId?: string;
    variant?: SplitButtonVariant;
    text: string;
    label?: string;
    title?: string;
    disabled?: boolean;
    menuDisabled?: boolean;
    menuLabel: string;
    menuTitle?: string;
    menuExpanded?: boolean;
    menuPopupType?: 'menu' | 'dialog' | 'listbox' | 'tree' | 'grid';
    type?: ButtonType;
    onClick?: (event: MouseEvent) => void;
    onMenuClick?: (event: MouseEvent | KeyboardEvent) => void;
  } & Record<string, unknown>>();

  const rootClass = $derived(`split-button split-button-${variant}`);
  const mainAriaLabel = $derived(label ?? text);

  const handleMenuKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }

    event.preventDefault();
    onMenuClick?.(event);
  };
</script>

<div class={rootClass}>
  <button
    {...rest}
    {id}
    class="split-button-segment split-button-main"
    {type}
    aria-label={mainAriaLabel}
    {disabled}
    {title}
    onclick={onClick}
  >
    {text}
  </button>
  <button
    id={menuId}
    type="button"
    class="split-button-segment split-button-trigger"
    aria-label={menuLabel}
    aria-haspopup={menuPopupType}
    aria-expanded={menuExpanded}
    disabled={menuDisabled}
    title={menuTitle}
    onclick={onMenuClick}
    onkeydown={handleMenuKeyDown}
  >
    <span class="material-symbols-rounded" aria-hidden="true">expand_more</span>
  </button>
</div>

<style lang="scss">
  .split-button {
    display: inline-flex;
    border-radius: var(--radius-6);
    overflow: hidden;

    &-secondary {
      background: var(--neutral-20);
      color: var(--neutral-90);
    }

    &-primary {
      background: var(--accent-500);
      color: var(--accent-050);
    }
  }

  .split-button-segment {
    border: 0;
    background: transparent;
    color: inherit;
    font-size: var(--text-13);
    cursor: pointer;
    white-space: nowrap;
    -webkit-app-region: no-drag;

    &:disabled {
      cursor: default;
      opacity: 0.6;
    }
  }

  .split-button-main {
    padding: var(--gap-6) var(--gap-8);
  }

  .split-button-trigger {
    width: 1.75rem;
    padding: 0;
    border-left: 1px solid color-mix(in srgb, currentColor 16%, transparent);
    display: inline-flex;
    align-items: center;
    justify-content: center;

    &[aria-expanded='true'] {
      background: color-mix(in srgb, currentColor 12%, transparent);
    }

    .material-symbols-rounded {
      font-size: var(--text-18);
      line-height: 1;
      font-variation-settings: 'FILL' 1, 'wght' 400;
    }
  }
</style>
