<script module lang="ts">
  let modalDialogIdSequence = 0;

  const allocateModalDialogId = (prefix: string): string => {
    modalDialogIdSequence += 1;
    return `${prefix}-${modalDialogIdSequence}`;
  };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onDestroy, tick } from 'svelte';
  import { Spring } from 'svelte/motion';
  import { SPRING_PRECISION } from '../../motion';
  import Button from '../primitives/Button.svelte';
  import {
    FLOATING_LAYER_ENTER_DURATION_MS,
    FLOATING_LAYER_ENTER_EASING,
    FLOATING_LAYER_EXIT_EASING,
    type FloatingLayerEnterTarget,
    type FloatingLayerExitTarget,
  } from './floating-layer';
  import { FloatingLayerPresence } from './floating-layer-presence.svelte';
  import { dismissAllFloatingLayers } from './floating-layer-stack';

  const MODAL_DIALOG_INPUT_SELECTOR = [
    'input:not([disabled])',
    'textarea:not([disabled])',
  ].join(', ');
  const FOCUSABLE_SELECTOR = [
    MODAL_DIALOG_INPUT_SELECTOR,
    'button:not([disabled])',
  ].join(', ');
  const MODAL_DIALOG_ENTER_SCALE = 1.06;
  const MODAL_DIALOG_EXIT_SCALE = 1.10;
  const MODAL_DIALOG_ENTER_SPRING_OPTIONS = {
    stiffness: 0.2,
    damping: 1,
    precision: SPRING_PRECISION,
  } as const;
  const MODAL_DIALOG_EXIT_ANIMATION_OPTIONS = {
    targetScale: MODAL_DIALOG_EXIT_SCALE,
    blurPx: 8,
    durationMs: 250,
    easing: FLOATING_LAYER_EXIT_EASING,
  } as const;
  const MODAL_DIALOG_BACKDROP_ENTER_ANIMATION_OPTIONS: Omit<
    FloatingLayerEnterTarget,
    'element'
  > = {
    blurPx: null,
    durationMs: FLOATING_LAYER_ENTER_DURATION_MS,
    easing: 'ease',
  };
  const MODAL_DIALOG_BACKDROP_EXIT_ANIMATION_OPTIONS: Omit<
    FloatingLayerExitTarget,
    'element'
  > = {
    targetScale: null,
    blurPx: null,
    durationMs: MODAL_DIALOG_EXIT_ANIMATION_OPTIONS.durationMs,
    easing: 'ease',
  };
  const MODAL_DIALOG_ENTER_ANIMATION_OPTIONS = {
    blurPx: 8,
    durationMs: FLOATING_LAYER_ENTER_DURATION_MS,
    easing: FLOATING_LAYER_ENTER_EASING,
  } as const;
  type ModalDialogText = {
    title: string;
    description: string | null;
    footerNote: string | null;
    confirmLabel: string;
    secondaryLabel: string | null;
    cancelLabel: string;
  };
  type ModalDialogDefaultAction = 'confirm' | 'cancel' | 'none';

  let {
    open = false,
    title,
    description = null,
    footerNote = null,
    confirmLabel = 'OK',
    secondaryLabel = null,
    cancelLabel = 'Cancel',
    busy = false,
    wide = false,
    defaultAction = 'confirm',
    onConfirm = () => {},
    onSecondary = () => {},
    onCancel = () => {},
    children,
  } = $props<{
    open?: boolean;
    title: string;
    description?: string | null;
    footerNote?: string | null;
    confirmLabel?: string;
    secondaryLabel?: string | null;
    cancelLabel?: string;
    busy?: boolean;
    wide?: boolean;
    defaultAction?: ModalDialogDefaultAction;
    onConfirm?: () => void | Promise<void>;
    onSecondary?: () => void | Promise<void>;
    onCancel?: () => void | Promise<void>;
    children?: Snippet;
  }>();

  let displayedText = $state<ModalDialogText>({
    title: '',
    description: null,
    footerNote: null,
    confirmLabel: 'OK',
    secondaryLabel: null,
    cancelLabel: 'Cancel',
  });
  let backdropEl = $state<HTMLDivElement | null>(null);
  let dialogEl = $state<HTMLDivElement | null>(null);
  let previouslyFocusedEl: HTMLElement | null = null;
  let wasOpen = false;
  let focusToken = 0;
  const presence = new FloatingLayerPresence();
  const dialogScale = new Spring(1, MODAL_DIALOG_ENTER_SPRING_OPTIONS);
  const titleId = allocateModalDialogId('modal-dialog-title');
  const descriptionId = allocateModalDialogId('modal-dialog-description');

  $effect(() => {
    if (!open) {
      return;
    }

    displayedText = {
      title,
      description,
      footerNote,
      confirmLabel,
      secondaryLabel,
      cancelLabel,
    };
  });

  const resolveFocusableElements = (): HTMLElement[] => {
    if (!dialogEl) {
      return [];
    }

    return [...dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
  };

  const focusInitialAction = async (): Promise<void> => {
    const token = ++focusToken;
    await tick();
    if (!open || token !== focusToken) {
      return;
    }

    const firstInputElement = dialogEl?.querySelector<HTMLElement>(
      MODAL_DIALOG_INPUT_SELECTOR,
    );
    const defaultActionElement = defaultAction === 'none'
      ? null
      : dialogEl?.querySelector<HTMLElement>(
          `[data-modal-action="${defaultAction}"]:not([disabled])`,
        );
    const initialFocusElement = firstInputElement
      ?? defaultActionElement
      ?? resolveFocusableElements()[0];
    if (initialFocusElement) {
      initialFocusElement.focus();
      return;
    }

    dialogEl?.focus();
  };

  const restorePreviousFocus = (): void => {
    if (!previouslyFocusedEl || !previouslyFocusedEl.isConnected) {
      previouslyFocusedEl = null;
      return;
    }

    previouslyFocusedEl.focus();
    previouslyFocusedEl = null;
  };

  const finishClose = (): void => {
    void dialogScale.set(1, { instant: true });
  };

  const startExit = (): void => {
    if (!presence.rendered || presence.exiting) {
      return;
    }
    if (!backdropEl || !dialogEl) {
      presence.hideImmediately();
      finishClose();
      return;
    }

    presence.hide(
      [
        {
          element: backdropEl,
          ...MODAL_DIALOG_BACKDROP_EXIT_ANIMATION_OPTIONS,
        },
        {
          element: dialogEl,
          ...MODAL_DIALOG_EXIT_ANIMATION_OPTIONS,
        },
      ],
      finishClose,
    );
  };

  const handleCancel = (): void => {
    if (busy) {
      return;
    }

    void onCancel();
  };

  const handleConfirm = (): void => {
    if (busy) {
      return;
    }

    void onConfirm();
  };

  const handleSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    handleConfirm();
  };

  const handleSecondary = (): void => {
    if (busy) {
      return;
    }

    void onSecondary();
  };

  const handleBackdropPointerDown = (event: PointerEvent): void => {
    if (event.target !== event.currentTarget) {
      return;
    }

    handleCancel();
  };

  const handleDefaultAction = (): void => {
    if (defaultAction === 'confirm') {
      handleConfirm();
    } else if (defaultAction === 'cancel') {
      handleCancel();
    }
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();

    if (event.key === 'Escape') {
      event.preventDefault();
      handleCancel();
      return;
    }

    if (event.key === 'Enter') {
      if (
        event.isComposing
        || event.target instanceof HTMLTextAreaElement
        || (
          event.target instanceof Element
          && event.target.closest('button') !== null
        )
      ) {
        return;
      }

      event.preventDefault();
      if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        handleDefaultAction();
      }
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusableElements = resolveFocusableElements();
    if (focusableElements.length === 0) {
      event.preventDefault();
      dialogEl?.focus();
      return;
    }

    const activeElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const isFocusWithinDialog = activeElement !== null && dialogEl?.contains(activeElement);

    if (event.shiftKey) {
      if (!isFocusWithinDialog || activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      }
      return;
    }

    if (!isFocusWithinDialog || activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  $effect(() => {
    if (open && !wasOpen) {
      dismissAllFloatingLayers();
      const shouldAnimateEnter = presence.show();
      previouslyFocusedEl = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      dialogScale.stiffness = MODAL_DIALOG_ENTER_SPRING_OPTIONS.stiffness;
      dialogScale.damping = MODAL_DIALOG_ENTER_SPRING_OPTIONS.damping;
      dialogScale.precision = MODAL_DIALOG_ENTER_SPRING_OPTIONS.precision;
      if (shouldAnimateEnter) {
        void dialogScale.set(MODAL_DIALOG_ENTER_SCALE, { instant: true });
        void tick().then(() => {
          if (!open || !backdropEl || !dialogEl) {
            return;
          }

          presence.enter([
            {
              element: backdropEl,
              ...MODAL_DIALOG_BACKDROP_ENTER_ANIMATION_OPTIONS,
            },
            {
              element: dialogEl,
              ...MODAL_DIALOG_ENTER_ANIMATION_OPTIONS,
            },
          ]);
          dialogScale.target = 1;
        });
      } else {
        dialogScale.target = 1;
      }
      void focusInitialAction();
    }

    if (!open && wasOpen) {
      restorePreviousFocus();
      startExit();
    }

    wasOpen = open;
  });

  onDestroy(() => {
    presence.destroy();
  });

  $effect(() => {
    if (!open || !busy) {
      return;
    }

    void tick().then(() => {
      if (!open || !busy) {
        return;
      }

      dialogEl?.focus();
    });
  });
</script>

{#if presence.rendered}
  <div
    bind:this={backdropEl}
    class="modal-dialog-backdrop"
    role="presentation"
    aria-hidden={!open}
    data-preserve-rack-selection="true"
    onpointerdown={handleBackdropPointerDown}
  >
    <div
      bind:this={dialogEl}
      class="modal-dialog"
      class:is-wide={wide}
      role="dialog"
      aria-hidden={!open}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={displayedText.description ? descriptionId : undefined}
      tabindex="-1"
      data-preserve-rack-selection="true"
      style:transform={`scale(${dialogScale.current})`}
      onkeydown={handleKeyDown}
    >
      <form onsubmit={handleSubmit}>
        <h2 id={titleId} class="modal-dialog-title">{displayedText.title}</h2>

        {#if displayedText.description}
          <p id={descriptionId} class="modal-dialog-description">{displayedText.description}</p>
        {/if}

        {#if children}
          <div class="modal-dialog-body">
            {@render children()}
          </div>
        {/if}

        <footer class="modal-dialog-actions">
          {#if displayedText.footerNote}
            <span class="modal-dialog-footer-note">{displayedText.footerNote}</span>
          {/if}
          <Button
            class="modal-dialog-action-button"
            type="button"
            variant={defaultAction === 'cancel' ? 'primary' : 'secondary'}
            data-modal-action="cancel"
            disabled={busy}
            text={displayedText.cancelLabel}
            onClick={handleCancel}
          />
          {#if displayedText.secondaryLabel}
            <Button
              class="modal-dialog-action-button"
              type="button"
              data-modal-action="secondary"
              disabled={busy}
              text={displayedText.secondaryLabel}
              onClick={handleSecondary}
            />
          {/if}
          <Button
            class="modal-dialog-action-button"
            type="submit"
            variant={defaultAction === 'confirm' ? 'primary' : 'secondary'}
            data-modal-action="confirm"
            disabled={busy}
            text={displayedText.confirmLabel}
          />
        </footer>
      </form>
    </div>
  </div>
{/if}

<style lang="scss">
  .modal-dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-layer-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--gap-16);
    background: var(--color-overlay-backdrop);
  }

  .modal-dialog {
    width: min(22rem, calc(100vw - 2rem));
    padding: var(--gap-16);
    border-radius: var(--radius-12);
    background: var(--color-surface-floating);
    backdrop-filter: blur(8px);
    border: 1px solid var(--color-border-floating);
    box-shadow: var(--shadow-floating);

    &.is-wide {
      width: min(28rem, calc(100vw - 2rem));
    }

    :global(input[type='text']),
    :global(textarea),
    :global(.button.modal-dialog-action-button:not(.button-primary)) {
      background: var(--color-surface-floating-interactive);
    }

    &-title {
      margin: 0 0 var(--gap-12);
      font-size: var(--text-16);
    }

    &-description {
      margin: 0 0 var(--gap-16);
      color: var(--color-text-secondary);
      font-size: var(--text-13);
    }

    &-body {
      margin-bottom: var(--gap-16);
    }

    &-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--gap-8);
    }

    &-footer-note {
      margin-right: auto;
      color: var(--color-text-secondary);
      font-size: var(--text-12);
    }
  }
</style>
