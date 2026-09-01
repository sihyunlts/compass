<script lang="ts">
  import {
    canDeletePresetContextTarget,
    canRenamePresetContextTarget,
    isPresetBrowserContextTarget,
    isRackSelectionContextTarget,
    type ModulationParameterContextTarget,
    type ContextMenuTarget,
    type PresetEntryContextTarget,
  } from '../../features/context-menu/types';
  import { i18n } from '../../i18n.svelte';
  import type { MessageKey } from '../../../shared/i18n';
  import {
    resolveShortcutPresentation,
    type AppShortcutId,
    type ShortcutPlatform,
  } from '../../../shared/keyboard-shortcuts';
  import FloatingDropdown from '../primitives/FloatingDropdown.svelte';

  let {
    platform,
    onCopy,
    onCut,
    onPaste,
    onDuplicate,
    onRename,
    onInfo,
    onDelete,
    onCreatePresetFolder,
    onShowInFolder,
    onGroup,
    onUngroupGroup,
    onDisconnectModulation,
    clipboardAvailable = false,
  } = $props<{
    platform: ShortcutPlatform;
    onCopy: (target: ContextMenuTarget) => void;
    onCut: (target: ContextMenuTarget) => void;
    onPaste: (target: ContextMenuTarget) => void;
    onDuplicate: (target: ContextMenuTarget) => void;
    onRename: (target: ContextMenuTarget) => void;
    onInfo: (target: ContextMenuTarget) => void;
    onDelete: (target: ContextMenuTarget) => void;
    onCreatePresetFolder: (target: PresetEntryContextTarget) => void;
    onShowInFolder: (target: PresetEntryContextTarget) => void;
    onGroup: (ids: string[]) => void;
    onUngroupGroup: (groupId: string) => void;
    onDisconnectModulation: (
      target: ModulationParameterContextTarget,
      modulatorId?: string,
    ) => void;
    clipboardAvailable?: boolean;
  }>();

  let isOpen = $state(false);
  let anchorPoint = $state<{ x: number; y: number } | null>(null);
  let target = $state<ContextMenuTarget | null>(null);

  const isPresetBrowserTarget = $derived.by(() =>
    isPresetBrowserContextTarget(target));
  const isDeletablePresetTarget = $derived(
    isPresetBrowserContextTarget(target)
      ? canDeletePresetContextTarget(target)
      : false,
  );
  const canCreatePresetFolder = $derived.by(() =>
    target?.kind === 'preset-entry'
    && target.entryKind === 'directory'
    && target.source === 'user');
  const canShowInFolder = $derived.by(() =>
    target?.kind === 'preset-entry' && target.source === 'user');
  const canPasteForTarget = $derived.by(() =>
    isRackSelectionContextTarget(target)
    && clipboardAvailable);
  type ClipboardActionKind = 'copy' | 'cut' | 'paste' | 'duplicate';
  type ClipboardActionMeta = {
    id: string;
    kind: ClipboardActionKind;
    labelKey: MessageKey;
    shortcutId: AppShortcutId;
    requiresClipboard?: boolean;
  };
  const CLIPBOARD_ACTIONS: readonly ClipboardActionMeta[] = [
    { id: 'context-cut', kind: 'cut', labelKey: 'context.cut', shortcutId: 'cut' },
    { id: 'context-copy', kind: 'copy', labelKey: 'context.copy', shortcutId: 'copy' },
    {
      id: 'context-paste',
      kind: 'paste',
      labelKey: 'context.paste',
      shortcutId: 'paste',
      requiresClipboard: true,
    },
    {
      id: 'context-duplicate',
      kind: 'duplicate',
      labelKey: 'context.duplicate',
      shortcutId: 'duplicate',
    },
  ];
  const visibleClipboardActions = $derived.by(() =>
    isRackSelectionContextTarget(target)
      ? CLIPBOARD_ACTIONS.filter((action) => !action.requiresClipboard || canPasteForTarget)
      : []);
  const canRenameTarget = $derived.by(() => {
    if (target?.kind === 'preset-entry') {
      return canRenamePresetContextTarget(target);
    }
    if (!isRackSelectionContextTarget(target)) {
      return false;
    }
    return target.kind === 'group' || target.deviceIds.length === 1;
  });
  const canShowInfo = $derived.by(() =>
    (
      target?.kind === 'preset-entry'
      && target.entryKind === 'file'
      && target.canShowInfo !== false
    )
    || target?.kind === 'group'
    || (target?.kind === 'devices' && target.deviceIds.length === 1));
  export function open(clientX: number, clientY: number, nextTarget: ContextMenuTarget) {
    if (
      (nextTarget.kind === 'devices' && nextTarget.deviceIds.length === 0)
      || (nextTarget.kind === 'group' && nextTarget.memberDeviceIds.length === 0)
    ) {
      close();
      return;
    }

    target = structuredClone(nextTarget);
    anchorPoint = { x: clientX, y: clientY };
    isOpen = true;
  }

  export function close() {
    isOpen = false;
    anchorPoint = null;
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

  function handleInfoClick() {
    if (!target || !canShowInfo) {
      return;
    }

    onInfo(target);
    close();
  }

  function handleShowInFolderClick() {
    if (target?.kind !== 'preset-entry') {
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

  function handleDisconnectModulationClick(modulatorId?: string) {
    if (target?.kind !== 'modulation-parameter') {
      return;
    }

    onDisconnectModulation(target, modulatorId);
    close();
  }

</script>

{#snippet menuItem(
  id: string,
  label: string,
  handler: () => void,
  shortcutId?: AppShortcutId,
)}
{@const shortcut = shortcutId
  ? resolveShortcutPresentation(shortcutId, platform)
  : null}
<button
  {id}
  class="floating-menu-item floating-menu-action"
  type="button"
  role="menuitem"
  aria-keyshortcuts={shortcut?.ariaKeyShortcuts}
  onclick={handler}
>
  <span>{label}</span>
  {#if shortcut}
    <kbd class="floating-menu-shortcut" aria-hidden="true">{shortcut.display}</kbd>
  {/if}
</button>
{/snippet}

<FloatingDropdown
  open={isOpen}
  {anchorPoint}
  class="context-menu"
  onClose={() => close()}
>
  {#if target}
    <div id="context-menu" class="floating-menu-list" role="menu">
    {#if isPresetBrowserTarget}
      {#if canShowInfo}
        {@render menuItem('context-info', i18n.t('context.info'), handleInfoClick)}
      {/if}
      {#if canCreatePresetFolder}
        {@render menuItem('context-new-folder', i18n.t('context.newFolder'), handleCreatePresetFolderClick)}
      {/if}
      {#if canRenameTarget}
        {@render menuItem(
          'context-rename',
          i18n.t('context.rename'),
          handleRenameClick,
          'renameSelection',
        )}
      {/if}
      {#if isDeletablePresetTarget}
        {#if canCreatePresetFolder || canRenameTarget}
          <hr class="floating-menu-separator" />
        {/if}
        {@render menuItem(
          'context-delete',
          i18n.t('context.delete'),
          handleDeleteClick,
          'deletePresetEntries',
        )}
        {#if canShowInFolder}
          <hr class="floating-menu-separator" />
        {/if}
      {/if}
      {#if canShowInFolder}
        {@render menuItem('context-show-in-folder', i18n.t('context.showInFolder'), handleShowInFolderClick)}
      {/if}
    {:else if target.kind === 'modulation-parameter'}
      {#if target.connections.length === 1}
        {@render menuItem(
          'context-disconnect-modulation',
          i18n.t('modulation.disconnect'),
          () => handleDisconnectModulationClick(),
        )}
      {:else}
        {@render menuItem(
          'context-disconnect-modulation-all',
          i18n.t('modulation.disconnectAll'),
          () => handleDisconnectModulationClick(),
        )}
        <hr class="floating-menu-separator" />
        {#each target.connections as connection (`${connection.modulatorId}:${connection.targetId}`)}
          {@render menuItem(
            `context-disconnect-modulation-${connection.modulatorId}-${connection.targetId}`,
            i18n.t('modulation.disconnectFrom', { modulator: connection.modulatorLabel }),
            () => handleDisconnectModulationClick(connection.modulatorId),
          )}
        {/each}
      {/if}
    {:else}
      {#if canShowInfo}
        {@render menuItem('context-info', i18n.t('context.info'), handleInfoClick)}
      {/if}
      {#each visibleClipboardActions as action (action.id)}
        {@render menuItem(
          action.id,
          i18n.t(action.labelKey),
          () => handleClipboardAction(action.kind),
          action.shortcutId,
        )}
      {/each}
      {#if canRenameTarget}
        {@render menuItem(
          'context-rename',
          i18n.t('context.rename'),
          handleRenameClick,
          'renameSelection',
        )}
      {/if}
      <hr class="floating-menu-separator" />
      {#if target.kind === 'devices'}
        {@render menuItem(
          'context-delete',
          i18n.t('context.delete'),
          handleDeleteClick,
          'deleteSelection',
        )}
        {#if target.canGroup}
          {@render menuItem(
            'context-group',
            i18n.t('context.group'),
            handleGroupClick,
            'groupSelection',
          )}
        {/if}
      {:else}
        {@render menuItem(
          'context-delete',
          i18n.t('context.delete'),
          handleDeleteClick,
          'deleteSelection',
        )}
        {@render menuItem(
          'context-ungroup',
          i18n.t('context.ungroup'),
          handleUngroupClick,
          'ungroupSelection',
        )}
      {/if}
    {/if}
    </div>
  {/if}
</FloatingDropdown>
