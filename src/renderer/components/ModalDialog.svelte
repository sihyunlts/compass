<script module lang="ts">
  let modalDialogIdSequence = 0;

  const allocateModalDialogId = (prefix: string): string => {
    modalDialogIdSequence += 1;
    return `${prefix}-${modalDialogIdSequence}`;
  };
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import Button from './Button.svelte';

  const ACTION_BUTTON_SELECTOR = 'button:not([disabled])';

  let {
    open = false,
    title,
    description = null,
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
    busy = false,
    onConfirm = () => {},
    onCancel = () => {},
  } = $props<{
    open?: boolean;
    title: string;
    description?: string | null;
    confirmLabel?: string;
    cancelLabel?: string;
    busy?: boolean;
    onConfirm?: () => void | Promise<void>;
    onCancel?: () => void | Promise<void>;
  }>();

  let dialogEl = $state<HTMLDivElement | null>(null);
  let previouslyFocusedEl: HTMLElement | null = null;
  let wasOpen = false;
  let focusToken = 0;
  const titleId = allocateModalDialogId('modal-dialog-title');
  const descriptionId = allocateModalDialogId('modal-dialog-description');

  const resolveFocusableElements = (): HTMLElement[] => {
    if (!dialogEl) {
      return [];
    }

    return [...dialogEl.querySelectorAll<HTMLElement>(ACTION_BUTTON_SELECTOR)];
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
      previouslyFocusedEl = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      void focusInitialAction();
    }

    if (!open && wasOpen) {
      restorePreviousFocus();
    }

    wasOpen = open;
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

{#if open}
  <div
    class="modal-dialog-backdrop"
    role="presentation"
    data-preserve-rack-selection="true"
    onpointerdown={handleBackdropPointerDown}
  >
    <div
      bind:this={dialogEl}
      class="modal-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      tabindex="-1"
      data-preserve-rack-selection="true"
      onkeydown={handleKeyDown}
    >
      <h2 id={titleId} class="modal-dialog-title">{title}</h2>

      {#if description}
        <p id={descriptionId} class="modal-dialog-description">{description}</p>
      {/if}

      <footer class="modal-dialog-actions">
        <Button
          class="modal-dialog-action-button"
          disabled={busy}
          text={cancelLabel}
          onClick={handleCancel}
        />
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
    background: rgb(0 0 0 / 0.4);
  }

  .modal-dialog {
    width: min(28rem, calc(100vw - 2rem));
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
      color: var(--neutral-50);
      font-size: var(--text-13);
    }

    &-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--gap-8);
    }
  }
</style>
