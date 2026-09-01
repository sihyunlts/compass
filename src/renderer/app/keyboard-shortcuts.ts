import type { EditorSession } from '../features/editor/session.svelte';
import { isTextEditingElement } from '../features/rack/text-editing';
import {
  matchesAppShortcut,
  type AppShortcutId,
  type ShortcutPlatform,
} from '../../shared/keyboard-shortcuts';

interface KeyboardShortcutOptions {
  editorSession: EditorSession;
  platform: ShortcutPlatform;
  closeContextMenu: () => void;
  interactiveElementSelector?: string;
  onNewRack?: () => void | Promise<void>;
  onSaveRack?: () => void | Promise<void>;
  onSaveRackAs?: () => void | Promise<void>;
  onBeforeUnload?: () => void;
}

type ShortcutCommand = readonly [AppShortcutId, () => boolean];
type ShortcutAction = readonly [AppShortcutId, () => void | Promise<void> | undefined];

const RACK_DEVICES_ELEMENT_ID = 'chain-devices';
const LOCAL_KEYBOARD_SCOPE_SELECTOR = [
  '[data-app-keyboard-scope="local"]',
  '[data-rack-keyboard-scope="local"]',
].join(', ');

const shouldPreserveRackSelection = (element: Element | null): boolean =>
  element instanceof HTMLElement
  && element.closest('[data-preserve-rack-selection="true"]') !== null;

const isLocalKeyboardTarget = (
  element: Element | null,
  interactiveElementSelector: string | undefined,
): boolean => {
  if (!element) {
    return false;
  }

  if (element.closest(LOCAL_KEYBOARD_SCOPE_SELECTOR)) {
    return true;
  }

  if (interactiveElementSelector && element.closest(interactiveElementSelector)) {
    return true;
  }

  return element instanceof HTMLElement && element.isContentEditable;
};

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
  const selectionCommands: readonly ShortcutCommand[] = [
    ['groupSelection', options.editorSession.commands.groupSelection],
    ['ungroupSelection', options.editorSession.commands.ungroupSelectedGroups],
    ['undo', options.editorSession.commands.undo],
    ['redo', options.editorSession.commands.redo],
    ['copy', options.editorSession.commands.copySelection],
    ['cut', options.editorSession.commands.cutSelection],
    ['paste', options.editorSession.commands.pasteClipboard],
    ['duplicate', options.editorSession.commands.duplicateSelection],
    ['selectAll', options.editorSession.commands.selectAllRackDevices],
  ];
  const rackCommands: readonly ShortcutCommand[] = [
    ['collapseSelection', options.editorSession.commands.collapseSelection],
    ['expandSelection', options.editorSession.commands.expandSelection],
    ['deleteSelection', options.editorSession.commands.deleteSelection],
  ];
  const fileActions: readonly ShortcutAction[] = [
    ['newRack', () => options.onNewRack?.()],
    ['saveRackAs', () => options.onSaveRackAs?.()],
    ['saveRack', () => options.onSaveRack?.()],
  ];

  const runCommandShortcut = (
    event: KeyboardEvent,
    commands: readonly ShortcutCommand[],
  ): boolean => {
    const command = commands.find(([id]) =>
      matchesAppShortcut(event, id, options.platform));
    if (!command) {
      return false;
    }

    closeContextMenuIfHandled(command[1](), options.closeContextMenu, event);
    return true;
  };

  const runActionShortcut = (event: KeyboardEvent): boolean => {
    const action = fileActions.find(([id]) =>
      matchesAppShortcut(event, id, options.platform));
    if (!action) {
      return false;
    }

    event.preventDefault();
    options.closeContextMenu();
    void action[1]();
    return true;
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      options.closeContextMenu();
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (isTextEditingElement(target)) {
      return;
    }

    if (matchesAppShortcut(event, 'renameSelection', options.platform)) {
      event.preventDefault();
      if (options.editorSession.commands.beginRenameSelection()) {
        options.closeContextMenu();
      }
      return;
    }

    if (runActionShortcut(event) || runCommandShortcut(event, selectionCommands)) {
      return;
    }

    if (isLocalKeyboardTarget(target, options.interactiveElementSelector)) {
      return;
    }

    if (matchesAppShortcut(event, 'toggleEnabled', options.platform)) {
      if (!event.repeat) {
        closeContextMenuIfHandled(
          options.editorSession.commands.toggleSelectedDevicesEnabled(),
          options.closeContextMenu,
          event,
        );
      }
      return;
    }

    runCommandShortcut(event, rackCommands);
  };

  const handleFocusIn = (event: FocusEvent): void => {
    const target = event.target instanceof Element ? event.target : null;

    if (shouldPreserveRackSelection(target)) {
      return;
    }

    if (
      !isTextEditingElement(target)
      && !isLocalKeyboardTarget(target, options.interactiveElementSelector)
    ) {
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
