<svelte:options runes={true} />

<script lang="ts">
  import { hint } from '../overlays/hint';

  type SplitButtonVariant = 'secondary' | 'primary' | 'outline';
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
    class: className = '',
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
    class?: string;
    onClick?: (event: MouseEvent) => void;
    onMenuClick?: (event: MouseEvent | KeyboardEvent) => void;
  } & Record<string, unknown>>();

  const rootClass = $derived(`split-button split-button-${variant} ${className}`.trim());
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
  {#if onClick}
    <button
      {...rest}
      {id}
      class="split-button-segment split-button-main"
      {type}
      aria-label={mainAriaLabel}
      {disabled}
      use:hint={title}
      onclick={onClick}
    >
      <span class="split-button-label">{text}</span>
    </button>
  {:else}
    <span
      {...rest}
      {id}
      class="split-button-segment split-button-main split-button-static"
      aria-label={mainAriaLabel}
      use:hint={title}
    >
      <span class="split-button-label">{text}</span>
    </span>
  {/if}
  <button
    id={menuId}
    type="button"
    class="split-button-segment split-button-trigger"
    aria-label={menuLabel}
    aria-haspopup={menuPopupType}
    aria-expanded={menuExpanded}
    disabled={menuDisabled}
    use:hint={menuExpanded ? undefined : menuTitle}
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
    }

    &-primary {
      background: var(--accent-500);
      color: var(--accent-050);
    }

    &-outline {
      background: transparent;
      box-shadow: inset 0 0 0 1px var(--neutral-20);

      .split-button-trigger {
        border-left-color: var(--neutral-20);
      }
    }

    &-segment {
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

    &-main {
      display: inline-flex;
      align-items: center;
      min-width: 0;
      padding: var(--gap-6) var(--gap-8);
    }

    &-static {
      cursor: default;
    }

    &-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &-trigger {
      width: 1.75rem;
      padding: 0;
      border-left: 1px solid color-mix(in srgb, currentColor 16%, transparent);
      display: inline-flex;
      align-items: center;
      justify-content: center;

      &[aria-expanded='true'] {
        background: var(--neutral-30);
      }

      .material-symbols-rounded {
        font-size: var(--text-18);
        line-height: 1;
        font-variation-settings: 'FILL' 1, 'wght' 400;
      }
    }
  }
</style>
