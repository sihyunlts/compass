<svelte:options runes={true} />

<script lang="ts">
  import type { ShortcutPresentation } from '../../../shared/keyboard-shortcuts';
  import { hint } from '../overlays/hint';
  import { buttonPress } from './button-press.svelte';

  type SplitButtonVariant = 'secondary' | 'primary' | 'outline';
  type ButtonType = 'button' | 'submit' | 'reset';

  let {
    id,
    secondaryId,
    variant = 'secondary',
    text,
    label,
    title,
    shortcut,
    disabled = false,
    secondaryDisabled = false,
    secondaryLabel,
    secondaryTitle,
    secondaryExpanded = false,
    secondaryPopupType,
    secondaryIcon = 'expand_more',
    type = 'button',
    class: className = '',
    onClick,
    onSecondaryClick,
    ...rest
  } = $props<{
    id?: string;
    secondaryId?: string;
    variant?: SplitButtonVariant;
    text: string;
    label?: string;
    title?: string;
    shortcut?: ShortcutPresentation;
    disabled?: boolean;
    secondaryDisabled?: boolean;
    secondaryLabel: string;
    secondaryTitle?: string;
    secondaryExpanded?: boolean;
    secondaryPopupType?: 'menu' | 'dialog' | 'listbox' | 'tree' | 'grid';
    secondaryIcon?: string;
    type?: ButtonType;
    class?: string;
    onClick?: (event: MouseEvent) => void;
    onSecondaryClick?: (event: MouseEvent | KeyboardEvent) => void;
  } & Record<string, unknown>>();

  const rootClass = $derived(`split-button split-button-${variant} ${className}`.trim());
  const mainAriaLabel = $derived(label ?? text);
  const mainHint = $derived(title && shortcut
    ? { text: title, shortcut: shortcut.display }
    : title);

  const handleSecondaryKeyDown = (event: KeyboardEvent): void => {
    if (!secondaryPopupType || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) {
      return;
    }

    event.preventDefault();
    onSecondaryClick?.(event);
  };
</script>

<div
  class={rootClass}
  use:buttonPress
>
  {#if onClick}
    <button
      {...rest}
      {id}
      class="split-button-segment split-button-main"
      {type}
      aria-label={mainAriaLabel}
      aria-keyshortcuts={disabled ? undefined : shortcut?.ariaKeyShortcuts}
      {disabled}
      use:hint={mainHint}
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
      use:hint={mainHint}
    >
      <span class="split-button-label">{text}</span>
    </span>
  {/if}
  <button
    id={secondaryId}
    type="button"
    class="split-button-segment split-button-trigger"
    aria-label={secondaryLabel}
    aria-haspopup={secondaryPopupType}
    aria-expanded={secondaryPopupType ? secondaryExpanded : undefined}
    disabled={secondaryDisabled}
    use:hint={secondaryExpanded ? undefined : secondaryTitle}
    onclick={onSecondaryClick}
    onkeydown={handleSecondaryKeyDown}
  >
    <span class="material-symbols-rounded" aria-hidden="true">{secondaryIcon}</span>
  </button>
</div>

<style lang="scss">
  .split-button {
    display: inline-flex;
    border-radius: var(--radius-6);
    overflow: hidden;

    &-secondary {
      background: var(--color-surface-interactive);
    }

    &-primary {
      .split-button-segment:disabled {
        opacity: 1;
        color: color-mix(in oklch, var(--color-text-inverse) 60%, transparent);
      }

      background: var(--color-surface-inverse);
      color: var(--color-text-inverse);
    }

    &-outline {
      background: transparent;
      outline: 1px solid var(--color-border-tertiary);
      outline-offset: -1px;

      .split-button-trigger {
        border-left-color: var(--color-border-tertiary);
      }
    }

    &-segment {
      border: 0;
      background: transparent;
      color: inherit;
      font-size: var(--text-13);
      white-space: nowrap;
      -webkit-app-region: no-drag;
      transition:
        background-color 80ms linear,
        color 80ms linear;

      &:disabled {
        opacity: 0.6;
      }
    }

    &:not(.split-button-primary) .split-button-segment:not(:disabled):hover {
      background: var(--split-button-hover-background, var(--color-surface-active));
      color: var(--color-text-primary);
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
      flex: 0 0 1.75rem;
      width: 1.75rem;
      padding: 0;
      border-left: 1px solid color-mix(in oklch, currentColor 16%, transparent);
      display: inline-flex;
      align-items: center;
      justify-content: center;

      &[aria-expanded='true'] {
        background: var(--split-button-expanded-background, var(--color-surface-active));
      }

      .material-symbols-rounded {
        font-size: var(--text-18);
        line-height: 1;
        font-variation-settings: 'FILL' 1, 'wght' 400;
      }
    }
  }
</style>
