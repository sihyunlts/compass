<script lang="ts">
  import { tick } from 'svelte';
  import { clamp } from '../../shared/math';
  import type { ContextMenuTarget } from '../state/context-menu';

  let {
    onCopy,
    onCut,
    onPaste,
    onDuplicate,
    onDelete,
    onGroup,
    onUngroupGroup,
    clipboardAvailable = false,
  } = $props<{
    onCopy: (target: ContextMenuTarget) => void;
    onCut: (target: ContextMenuTarget) => void;
    onPaste: (target: ContextMenuTarget) => void;
    onDuplicate: (target: ContextMenuTarget) => void;
    onDelete: (target: ContextMenuTarget) => void;
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
  const canPasteForTarget = $derived.by(() => target !== null && clipboardAvailable);
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
    CLIPBOARD_ACTIONS.filter((action) => !action.requiresClipboard || canPasteForTarget));

  const MARGIN_PX = 8;

  export async function open(clientX: number, clientY: number, nextTarget: ContextMenuTarget) {
    if (
      (nextTarget.kind === 'devices' && nextTarget.deviceIds.length === 0)
      || (nextTarget.kind === 'group' && nextTarget.memberDeviceIds.length === 0)
    ) {
      close();
      return;
    }

    target = nextTarget.kind === 'devices'
      ? {
        kind: 'devices',
        deviceIds: [...nextTarget.deviceIds],
        canGroup: nextTarget.canGroup,
      }
      : {
        kind: 'group',
        groupId: nextTarget.groupId,
        memberDeviceIds: [...nextTarget.memberDeviceIds],
      };
    isPositioned = false;
    isOpen = true;
    const token = ++openToken;
    await tick();

    if (!menuEl || token !== openToken || !isOpen) {
      return;
    }

    const menuWidth = menuEl.offsetWidth;
    const menuHeight = menuEl.offsetHeight;
    const maxX = Math.max(MARGIN_PX, window.innerWidth - menuWidth - MARGIN_PX);
    const maxY = Math.max(MARGIN_PX, window.innerHeight - menuHeight - MARGIN_PX);

    x = clamp(clientX, MARGIN_PX, maxX);
    y = clamp(clientY, MARGIN_PX, maxY);
    isPositioned = true;
  }

  export function close() {
    openToken += 1;
    isOpen = false;
    isPositioned = false;
    target = null;
  }

  function handleWindowPointerDown(event: PointerEvent) {
    if (!isOpen || !menuEl) return;
    if (event.target instanceof Node && menuEl.contains(event.target)) return;
    close();
  }

  function handleWindowResize() {
    close();
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
</script>

<svelte:window onpointerdown={handleWindowPointerDown} onresize={handleWindowResize} />

<div
  bind:this={menuEl}
  id="context-menu"
  class="context-menu"
  class:is-open={isOpen && isPositioned}
  role="menu"
  aria-hidden={!isOpen}
  hidden={!isOpen}
  style:transform={isOpen ? `translate3d(${x}px, ${y}px, 0)` : undefined}
>
  {#if target}
    {#each visibleClipboardActions as action (action.id)}
      <button
        id={action.id}
        class="context-menu-item"
        type="button"
        role="menuitem"
        onclick={() => handleClipboardAction(action.kind)}
      >
        {action.label}
      </button>
    {/each}
    <hr class="context-menu-separator" role="separator" />
    {#if target.kind === 'devices'}
      <button
        id="context-delete"
        class="context-menu-item"
        type="button"
        role="menuitem"
        onclick={handleDeleteClick}
      >
        Delete
      </button>
      {#if target.canGroup}
        <button
          id="context-group"
          class="context-menu-item"
          type="button"
          role="menuitem"
          onclick={handleGroupClick}
        >
          Group
        </button>
      {/if}
    {:else}
      <button
        id="context-delete"
        class="context-menu-item"
        type="button"
        role="menuitem"
        onclick={handleDeleteClick}
      >
        Delete
      </button>
      <button
        id="context-ungroup"
        class="context-menu-item"
        type="button"
        role="menuitem"
        onclick={handleUngroupClick}
      >
        Ungroup
      </button>
    {/if}
  {/if}
</div>

<style lang="scss">
  .context-menu {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 42;
    min-width: 120px;
    padding: var(--gap-4);
    border: 1px solid var(--neutral-30);
    border-radius: var(--radius-8);
    background: var(--neutral-10);
    transform: translate3d(-9999px, -9999px, 0);
    opacity: 0;

    &.is-open {
      opacity: 1;
    }

    &-item {
      display: block;
      width: 100%;
      border-radius: var(--radius-4);
      background: transparent;
      text-align: start;
      font-size: var(--text-13);
      padding: var(--gap-6) var(--gap-8);

      &:hover {
        background: var(--neutral-20);
      }
    }

    &-separator {
      margin: var(--gap-4) var(--gap-6);
      border: 0;
      border-top: 1px solid var(--neutral-30);
    }
  }
</style>
