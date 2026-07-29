<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { ContextMenuTarget } from '../../features/context-menu/types';
  import {
    attachFloatingLayerDismissHandlers,
    isEventTargetWithinFloatingLayer,
    resolveViewportFloatingLayerPosition,
  } from './floating-layer';
  import { FloatingLayerPresence } from './floating-layer-presence.svelte';
  import { i18n } from '../../i18n.svelte';
  import type { MessageKey } from '../../../shared/i18n';

  let {
    onCopy,
    onCut,
    onPaste,
    onDuplicate,
    onRename,
    onDelete,
    onCreatePresetFolder,
    onShowInFolder,
    onGroup,
    onUngroupGroup,
    clipboardAvailable = false,
  } = $props<{
    onCopy: (target: ContextMenuTarget) => void;
    onCut: (target: ContextMenuTarget) => void;
    onPaste: (target: ContextMenuTarget) => void;
    onDuplicate: (target: ContextMenuTarget) => void;
    onRename: (target: ContextMenuTarget) => void;
    onDelete: (target: ContextMenuTarget) => void;
    onCreatePresetFolder: (target: Extract<ContextMenuTarget, { kind: 'preset-entry' }>) => void;
    onShowInFolder: (
      target: Extract<ContextMenuTarget, { kind: 'preset-entry' | 'presets-root' }>,
    ) => void;
    onGroup: (ids: string[]) => void;
    onUngroupGroup: (groupId: string) => void;
    clipboardAvailable?: boolean;
  }>();

  let isOpen = $state(false);
  let isPositioned = $state(false);
  let x = $state(0);
  let y = $state(0);
  let target = $state<ContextMenuTarget | null>(null);
  let menuEl = $state<HTMLElement | null>(null);
  let openToken = 0;
  const presence = new FloatingLayerPresence();

  const isPresetBrowserTarget = $derived.by(() =>
    target?.kind === 'preset-entry' || target?.kind === 'presets-root');
  const isDeletablePresetTarget = $derived.by(() =>
    target?.kind === 'preset-entry');
  const canCreatePresetFolder = $derived.by(() =>
    target?.kind === 'preset-entry' && target.entryKind === 'directory');
  const canPasteForTarget = $derived.by(() =>
    target !== null
    && target.kind !== 'preset-entry'
    && target.kind !== 'presets-root'
    && clipboardAvailable);
  type ClipboardActionKind = 'copy' | 'cut' | 'paste' | 'duplicate';
  type ClipboardActionMeta = {
    id: string;
    kind: ClipboardActionKind;
    labelKey: MessageKey;
    requiresClipboard?: boolean;
  };
  const CLIPBOARD_ACTIONS: readonly ClipboardActionMeta[] = [
    { id: 'context-cut', kind: 'cut', labelKey: 'context.cut' },
    { id: 'context-copy', kind: 'copy', labelKey: 'context.copy' },
    { id: 'context-paste', kind: 'paste', labelKey: 'context.paste', requiresClipboard: true },
    { id: 'context-duplicate', kind: 'duplicate', labelKey: 'context.duplicate' },
  ];
  const visibleClipboardActions = $derived.by(() =>
    target?.kind === 'preset-entry' || target?.kind === 'presets-root'
      ? []
      : CLIPBOARD_ACTIONS.filter((action) => !action.requiresClipboard || canPasteForTarget));
  const canRenameTarget = $derived.by(() =>
    target !== null
    && (
      (target.kind === 'preset-entry' && target.entryKind === 'directory' && target.relativePath.length > 0)
      || (target.kind === 'preset-entry' && target.entryKind === 'file')
      || (target.kind !== 'preset-entry'
        && target.kind !== 'presets-root'
        && (target.kind === 'group' || target.deviceIds.length === 1))
    ));
  export async function open(clientX: number, clientY: number, nextTarget: ContextMenuTarget) {
    if (
      (nextTarget.kind === 'devices' && nextTarget.deviceIds.length === 0)
      || (nextTarget.kind === 'group' && nextTarget.memberDeviceIds.length === 0)
    ) {
      close();
      return;
    }

    target = structuredClone(nextTarget);
    presence.show();
    isPositioned = false;
    isOpen = true;
    const token = ++openToken;
    await tick();

    if (!menuEl || token !== openToken || !isOpen) {
      return;
    }

    const nextPosition = resolveViewportFloatingLayerPosition(clientX, clientY, {
      width: menuEl.offsetWidth,
      height: menuEl.offsetHeight,
    });

    x = nextPosition.x;
    y = nextPosition.y;
    isPositioned = true;
  }

  export function close() {
    openToken += 1;
    isOpen = false;
    if (!presence.rendered || presence.exiting) {
      return;
    }

    const finishClose = (): void => {
      isPositioned = false;
      target = null;
    };

    if (!menuEl || !isPositioned) {
      presence.hideImmediately();
      finishClose();
      return;
    }

    presence.hide([{ element: menuEl }], finishClose);
  }

  function handleDeleteClick() {
    if (!target) {
      return;
    }
    onDelete(target);
    close();
  }

  function handleClipboardAction(kind: ClipboardActionKind) {
    if (!target) {
      return;
    }

    if (kind === 'paste' && !canPasteForTarget) {
      return;
    }

    if (kind === 'copy') {
      onCopy(target);
    } else if (kind === 'cut') {
      onCut(target);
    } else if (kind === 'paste') {
      onPaste(target);
    } else {
      onDuplicate(target);
    }

    close();
  }

  function handleRenameClick() {
    if (!target || !canRenameTarget) {
      return;
    }

    onRename(target);
    close();
  }

  function handleShowInFolderClick() {
    if (target?.kind !== 'preset-entry' && target?.kind !== 'presets-root') {
      return;
    }

    onShowInFolder(target);
    close();
  }

  function handleCreatePresetFolderClick() {
    if (target?.kind !== 'preset-entry' || target.entryKind !== 'directory') {
      return;
    }

    onCreatePresetFolder(target);
    close();
  }

  function handleGroupClick() {
    if (target?.kind !== 'devices') {
      return;
    }
    onGroup([...target.deviceIds]);
    close();
  }

  function handleUngroupClick() {
    if (target?.kind !== 'group') {
      return;
    }
    onUngroupGroup(target.groupId);
    close();
  }

  onMount(() => {
    const detachDismissHandlers = attachFloatingLayerDismissHandlers({
      isActive: () => isOpen,
      containsEventTarget: (eventTarget) => isEventTargetWithinFloatingLayer(eventTarget, menuEl),
      onPointerDownOutside: close,
      onResize: close,
      onDismissRequest: close,
    });

    return () => {
      presence.destroy();
      detachDismissHandlers();
    };
  });
</script>

{#snippet menuItem(id: string, label: string, handler: () => void)}
<button
  {id}
  class="context-menu-item floating-menu-item"
  type="button"
  role="menuitem"
  onclick={handler}
>
  {label}
</button>
{/snippet}

<div
  bind:this={menuEl}
  id="context-menu"
  class="context-menu floating-menu-surface"
  class:is-open={presence.rendered && isPositioned}
  role="menu"
  aria-hidden={!isOpen || !isPositioned}
  hidden={!presence.rendered}
  style:transform={presence.rendered ? `translate3d(${x}px, ${y}px, 0)` : undefined}
>
  {#if target}
    {#if isPresetBrowserTarget}
      {#if canCreatePresetFolder}
        {@render menuItem('context-new-folder', i18n.t('context.newFolder'), handleCreatePresetFolderClick)}
      {/if}
      {#if canRenameTarget}
        {@render menuItem('context-rename', i18n.t('context.rename'), handleRenameClick)}
      {/if}
      {#if isDeletablePresetTarget}
        {#if canCreatePresetFolder || canRenameTarget}
          <hr class="context-menu-separator floating-menu-separator" />
        {/if}
        {@render menuItem('context-delete', i18n.t('context.delete'), handleDeleteClick)}
        <hr class="context-menu-separator floating-menu-separator" />
      {/if}
      {@render menuItem('context-show-in-folder', i18n.t('context.showInFolder'), handleShowInFolderClick)}
    {:else}
      {#each visibleClipboardActions as action (action.id)}
        {@render menuItem(action.id, i18n.t(action.labelKey), () => handleClipboardAction(action.kind))}
      {/each}
      {#if canRenameTarget}
        {@render menuItem('context-rename', i18n.t('context.rename'), handleRenameClick)}
      {/if}
      <hr class="context-menu-separator floating-menu-separator" />
      {#if target.kind === 'devices'}
        {@render menuItem('context-delete', i18n.t('context.delete'), handleDeleteClick)}
        {#if target.canGroup}
          {@render menuItem('context-group', i18n.t('context.group'), handleGroupClick)}
        {/if}
      {:else}
        {@render menuItem('context-delete', i18n.t('context.delete'), handleDeleteClick)}
        {@render menuItem('context-ungroup', i18n.t('context.ungroup'), handleUngroupClick)}
      {/if}
    {/if}
  {/if}
</div>

<style lang="scss">
  .context-menu {
    transform: translate3d(-9999px, -9999px, 0);
    visibility: hidden;
    pointer-events: none;

    &.is-open {
      visibility: visible;
      pointer-events: auto;
    }
  }
</style>
