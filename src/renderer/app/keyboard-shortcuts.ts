import type { EditorSession } from '../features/editor/session.svelte';
import { isTextEditingElement } from '../features/rack/text-editing';

interface KeyboardShortcutOptions {
  editorSession: EditorSession;
  closeContextMenu: () => void;
  onBeforeUnload?: () => void;
}

const RACK_DEVICES_ELEMENT_ID = 'chain-devices';

const shouldPreserveRackSelection = (element: Element | null): boolean =>
  element instanceof HTMLElement
  && element.closest('[data-preserve-rack-selection="true"]') !== null;

const closeContextMenuIfHandled = (
  handled: boolean,
  closeContextMenu: () => void,
  event: KeyboardEvent,
): boolean => {
  if (!handled) {
    return false;
  }

  event.preventDefault();
  closeContextMenu();
  return true;
};

/** Mounts global keyboard and window handlers used by the main editor shell. */
export const mountKeyboardShortcuts = (
  options: KeyboardShortcutOptions,
): (() => void) => {
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      options.closeContextMenu();
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (isTextEditingElement(target)) {
      return;
    }

    const isGroupShortcut =
      (event.metaKey || event.ctrlKey)
      && event.key.toLowerCase() === 'g';
    if (isGroupShortcut) {
      const handled = event.shiftKey
        ? options.editorSession.commands.ungroupSelectedGroups()
        : options.editorSession.commands.groupSelection();
      closeContextMenuIfHandled(handled, options.closeContextMenu, event);
      return;
    }

    const isModifierShortcut = (event.metaKey || event.ctrlKey) && !event.altKey;
    if (isModifierShortcut) {
      const key = event.key.toLowerCase();

      if (key === 'r' && !event.shiftKey) {
        event.preventDefault();
        if (options.editorSession.commands.beginRenameSelection()) {
          options.closeContextMenu();
        }
        return;
      }

      if (key === 'z' && !event.shiftKey) {
        closeContextMenuIfHandled(
          options.editorSession.commands.undo(),
          options.closeContextMenu,
          event,
        );
        return;
      }

      const isRedoShortcut =
        (key === 'z' && event.shiftKey)
        || (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey);
      if (isRedoShortcut) {
        closeContextMenuIfHandled(
          options.editorSession.commands.redo(),
          options.closeContextMenu,
          event,
        );
        return;
      }

      if (key === 'c') {
        closeContextMenuIfHandled(
          options.editorSession.commands.copySelection(),
          options.closeContextMenu,
          event,
        );
        return;
      }

      if (key === 'x') {
        closeContextMenuIfHandled(
          options.editorSession.commands.cutSelection(),
          options.closeContextMenu,
          event,
        );
        return;
      }

      if (key === 'v') {
        closeContextMenuIfHandled(
          options.editorSession.commands.pasteClipboard(),
          options.closeContextMenu,
          event,
        );
        return;
      }

      if (key === 'd') {
        closeContextMenuIfHandled(
          options.editorSession.commands.duplicateSelection(),
          options.closeContextMenu,
          event,
        );
        return;
      }

      if (key === 'a') {
        closeContextMenuIfHandled(
          options.editorSession.commands.selectAllRackDevices(),
          options.closeContextMenu,
          event,
        );
      }
      return;
    }

    if (event.key !== 'Delete' && event.key !== 'Backspace') {
      return;
    }

    closeContextMenuIfHandled(
      options.editorSession.commands.deleteSelection(),
      options.closeContextMenu,
      event,
    );
  };

  const handleFocusIn = (event: FocusEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!isTextEditingElement(target)) {
      return;
    }

    if (shouldPreserveRackSelection(target)) {
      return;
    }

    options.editorSession.clearSelection();
  };

  const handlePointerDown = (event: PointerEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    const rackEl = document.getElementById(RACK_DEVICES_ELEMENT_ID);
    if (rackEl && rackEl.contains(target)) {
      return;
    }

    if (shouldPreserveRackSelection(target)) {
      return;
    }

    options.editorSession.clearSelection();
  };

  const handleBeforeUnload = (): void => {
    options.onBeforeUnload?.();
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('focusin', handleFocusIn);
  window.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('beforeunload', handleBeforeUnload);

  return () => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('focusin', handleFocusIn);
    window.removeEventListener('pointerdown', handlePointerDown);
    window.removeEventListener('beforeunload', handleBeforeUnload);
  };
};
