<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { ContextMenuTarget } from '../../features/context-menu/types';
  import {
    attachFloatingLayerDismissHandlers,
    isEventTargetWithinFloatingLayer,
    resolveViewportFloatingLayerPosition,
  } from '../../features/rack/floating-layer';

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
    label: string;
    requiresClipboard?: boolean;
  };
  const CLIPBOARD_ACTIONS: readonly ClipboardActionMeta[] = [
    { id: 'context-cut', kind: 'cut', label: 'Cut' },
    { id: 'context-copy', kind: 'copy', label: 'Copy' },
    { id: 'context-paste', kind: 'paste', label: 'Paste', requiresClipboard: true },
    { id: 'context-duplicate', kind: 'duplicate', label: 'Duplicate' },
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
    isPositioned = false;
    target = null;
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

  onMount(() =>
    attachFloatingLayerDismissHandlers({
      isActive: () => isOpen,
      containsEventTarget: (eventTarget) => isEventTargetWithinFloatingLayer(eventTarget, menuEl),
      onPointerDownOutside: close,
      onResize: close,
      onDismissRequest: close,
    }));
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
  class:is-open={isOpen && isPositioned}
  role="menu"
  aria-hidden={!isOpen}
  hidden={!isOpen}
  style:transform={isOpen ? `translate3d(${x}px, ${y}px, 0)` : undefined}
>
  {#if target}
    {#if isPresetBrowserTarget}
      {#if canCreatePresetFolder}
        {@render menuItem('context-new-folder', 'New Folder', handleCreatePresetFolderClick)}
      {/if}
      {#if canRenameTarget}
        {@render menuItem('context-rename', 'Rename', handleRenameClick)}
      {/if}
      {#if isDeletablePresetTarget}
        {#if canCreatePresetFolder || canRenameTarget}
          <hr class="context-menu-separator floating-menu-separator" />
        {/if}
        {@render menuItem('context-delete', 'Delete', handleDeleteClick)}
        <hr class="context-menu-separator floating-menu-separator" />
      {/if}
      {@render menuItem('context-show-in-folder', 'Show in Folder', handleShowInFolderClick)}
    {:else}
      {#each visibleClipboardActions as action (action.id)}
        {@render menuItem(action.id, action.label, () => handleClipboardAction(action.kind))}
      {/each}
      {#if canRenameTarget}
        {@render menuItem('context-rename', 'Rename', handleRenameClick)}
      {/if}
      <hr class="context-menu-separator floating-menu-separator" />
      {#if target.kind === 'devices'}
        {@render menuItem('context-delete', 'Delete', handleDeleteClick)}
        {#if target.canGroup}
          {@render menuItem('context-group', 'Group', handleGroupClick)}
        {/if}
      {:else}
        {@render menuItem('context-delete', 'Delete', handleDeleteClick)}
        {@render menuItem('context-ungroup', 'Ungroup', handleUngroupClick)}
      {/if}
    {/if}
  {/if}
</div>

<style lang="scss">
  .context-menu {
    transform: translate3d(-9999px, -9999px, 0);
    opacity: 0;

    &.is-open {
      opacity: 1;
    }
  }
</style>
