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
  } from './floating-layer';
  import { FloatingLayerPresence } from './floating-layer-presence.svelte';

  const FOCUSABLE_SELECTOR = 'input:not([disabled]), button:not([disabled])';
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
  const MODAL_DIALOG_BACKDROP_ENTER_ANIMATION_OPTIONS = {
    blurPx: null,
    durationMs: FLOATING_LAYER_ENTER_DURATION_MS,
    easing: 'ease',
  } as const;
  const MODAL_DIALOG_BACKDROP_EXIT_ANIMATION_OPTIONS = {
    targetScale: null,
    blurPx: null,
    durationMs: MODAL_DIALOG_EXIT_ANIMATION_OPTIONS.durationMs,
    easing: 'ease',
  } as const;
  const MODAL_DIALOG_ENTER_ANIMATION_OPTIONS = {
    blurPx: 8,
    durationMs: FLOATING_LAYER_ENTER_DURATION_MS,
    easing: FLOATING_LAYER_ENTER_EASING,
  } as const;

  let {
    open = false,
    title,
    description = null,
    confirmLabel = 'OK',
    secondaryLabel = null,
    cancelLabel = 'Cancel',
    busy = false,
    onConfirm = () => {},
    onSecondary = () => {},
    onCancel = () => {},
    children,
  } = $props<{
    open?: boolean;
    title: string;
    description?: string | null;
    confirmLabel?: string;
    secondaryLabel?: string | null;
    cancelLabel?: string;
    busy?: boolean;
    onConfirm?: () => void | Promise<void>;
    onSecondary?: () => void | Promise<void>;
    onCancel?: () => void | Promise<void>;
    children?: Snippet;
  }>();

  let backdropEl = $state<HTMLDivElement | null>(null);
  let dialogEl = $state<HTMLDivElement | null>(null);
  let previouslyFocusedEl: HTMLElement | null = null;
  let wasOpen = false;
  let focusToken = 0;
  const presence = new FloatingLayerPresence();
  const dialogScale = new Spring(1, MODAL_DIALOG_ENTER_SPRING_OPTIONS);
  const titleId = allocateModalDialogId('modal-dialog-title');
  const descriptionId = allocateModalDialogId('modal-dialog-description');

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

    const firstFocusableElement = resolveFocusableElements()[0];
    if (firstFocusableElement) {
      firstFocusableElement.focus();
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

  const handleKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();

    if (event.key === 'Escape') {
      event.preventDefault();
      handleCancel();
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
      role="dialog"
      aria-hidden={!open}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      tabindex="-1"
      data-preserve-rack-selection="true"
      style:transform={`scale(${dialogScale.current})`}
      onkeydown={handleKeyDown}
    >
      <h2 id={titleId} class="modal-dialog-title">{title}</h2>

      {#if description}
        <p id={descriptionId} class="modal-dialog-description">{description}</p>
      {/if}

      {#if children}
        <div class="modal-dialog-body">
          {@render children()}
        </div>
      {/if}

      <footer class="modal-dialog-actions">
        <Button
          class="modal-dialog-action-button"
          disabled={busy}
          text={cancelLabel}
          onClick={handleCancel}
        />
        {#if secondaryLabel}
          <Button
            class="modal-dialog-action-button"
            disabled={busy}
            text={secondaryLabel}
            onClick={handleSecondary}
          />
        {/if}
        <Button
          class="modal-dialog-action-button"
          disabled={busy}
          text={confirmLabel}
          onClick={handleConfirm}
        />
      </footer>
    </div>
  </div>
{/if}

<style lang="scss">
  .modal-dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--gap-16);
    background: oklch(0% 0 0 / 0.4);
  }

  .modal-dialog {
    width: min(22rem, calc(100vw - 2rem));
    padding: var(--gap-16);
    border-radius: var(--radius-12);
    background: var(--neutral-10);
    border: 1px solid var(--neutral-20);

    &-title {
      margin: 0 0 var(--gap-12);
      font-size: var(--text-16);
    }

    &-description {
      margin: 0 0 var(--gap-16);
      color: var(--neutral-60);
      font-size: var(--text-13);
    }

    &-body {
      margin-bottom: var(--gap-16);
    }

    &-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--gap-8);
    }
  }
</style>
