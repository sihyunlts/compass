<script lang="ts">
  import { onDestroy, onMount, tick, untrack, type ComponentProps } from 'svelte';
  import { touchGestures } from '../../features/touch-gestures';
  import { isDeviceBrowserSystemDirectoryPath } from '../../../devices/browser-categories';
  import type { PresetBrowserTreeFolderNode, PresetBrowserTreeNode } from '../../../shared/contracts/ipc/presets';
  import type { PendingPresetFolderDraft } from '../../features/browser/types';
  import type { PresetController } from '../../app/preset-controller.svelte';
  import { resolvePresetNameFromFileName } from '../../../shared/preset/file';
  import { arePresetPathsEqual } from '../../../shared/preset/entry-selection';
  import { browserPresetSaveDialog as dialog } from '../../app/browser-preset-save-dialog.svelte';
  import { i18n } from '../../i18n.svelte';
  import type { ShortcutPlatform } from '../../../shared/keyboard-shortcuts';
  import {
    resolvePresetSelectionContextTarget,
    type ContextMenuTarget,
    type PresetEntryContextTarget,
  } from '../../features/context-menu/types';
  import { createBrowserSelection } from '../../features/browser/selection.svelte';
  import { resolvePresetBrowserEntryIcon } from '../../features/browser/preset-entry-presentation';
  import BrowserEntryContent from '../browser/BrowserEntryContent.svelte';
  import BrowserEntryNameInput from '../browser/BrowserEntryNameInput.svelte';
  import TextField from '../fields/TextField.svelte';
  import Button from '../primitives/Button.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import ModalDialog from './ModalDialog.svelte';

  let {
    platform,
    browserClipboardPresetType = null,
    presetTree,
    menuActions,
    onCommitEntryDraft,
  } = $props<{
    platform: ShortcutPlatform;
    browserClipboardPresetType?: PresetEntryContextTarget['presetType'] | null;
    presetTree: readonly PresetBrowserTreeFolderNode[];
    menuActions: Pick<ComponentProps<typeof ContextMenu>,
      'onCopy' | 'onDelete' | 'onDuplicate' | 'onInfo' | 'onPaste' | 'onShowInFolder'>;
    onCommitEntryDraft: PresetController['commitPresetEntryDraft'];
  }>();

  let name = $state('');
  let folder = $state<string[]>([]);
  let conflict = $state<string | null>(null);
  let error = $state('');
  let entryDraft = $state<PendingPresetFolderDraft | null>(null);
  let busy = $state(false);
  let fileList = $state<HTMLDivElement | null>(null);
  let focusedEntryId = $state<string | null>(null);
  let contextMenu = $state<ReturnType<typeof ContextMenu> | null>(null);
  const browserSelection = createBrowserSelection();

  const rootLabel = $derived(i18n.t(dialog.request?.presetType === 'device'
    ? 'browser.devices' : dialog.request?.presetType === 'group' ? 'browser.groups' : 'browser.racks'));
  const resolveEntries = (
    path: readonly string[],
    rootEntries: PresetBrowserTreeNode[],
  ): PresetBrowserTreeNode[] => {
    let children = rootEntries;
    for (let depth = 1; depth <= path.length; depth += 1) {
      const node = children.find((entry) => entry.kind === 'folder'
        && arePresetPathsEqual(entry.relativePath, path.slice(0, depth)));
      if (!node || node.kind !== 'folder') return [];
      children = node.children;
    }
    return children;
  };
  const tree = $derived(presetTree.find((root: PresetBrowserTreeFolderNode) =>
    root.presetType === dialog.request?.presetType && root.source === 'user')
    ?.children.filter((entry: PresetBrowserTreeNode) => entry.source === 'user') ?? []);
  const entries = $derived(resolveEntries(folder, tree));
  const editingEntry = $derived(entryDraft?.mode === 'rename'
    ? entries.find((entry) => arePresetPathsEqual(entry.relativePath, entryDraft.relativePath))
    : undefined);
  const entryIds = $derived(entries.map((entry) => entry.id));

  $effect(() => {
    const request = dialog.request;
    untrack(() => {
      if (request) {
        name = request.name;
        folder = [...request.folder];
        browserSelection.clear();
        focusedEntryId = entries[0]?.id ?? null;
        conflict = null;
        error = '';
        entryDraft = null;
      } else {
        contextMenu?.close();
        conflict = null;
      }
    });
  });

  $effect(() => {
    const ids = entryIds;
    untrack(() => {
      browserSelection.reconcile(ids);
      if (!ids.includes(focusedEntryId ?? '')) focusedEntryId = ids[0] ?? null;
    });
  });

  const resetConflict = (): void => { conflict = null; error = ''; };
  const navigate = (path: string[]): void => {
    folder = [...path];
    browserSelection.clear();
    focusedEntryId = entries[0]?.id ?? null;
    entryDraft = null;
    resetConflict();
    void tick().then(() => {
      const target = fileList?.querySelector<HTMLElement>('[data-save-entry]')
        ?? document.getElementById('browser-preset-save-name');
      target?.focus();
    });
  };
  const selectEntry = (entry: PresetBrowserTreeNode): void => {
    browserSelection.selectSingle(entry.id, entryIds);
    if (entry.kind === 'preset') name = entry.label;
    resetConflict();
  };
  const openEntry = (entry: PresetBrowserTreeNode): void => {
    if (entry.kind === 'folder') navigate(entry.relativePath);
    else {
      selectEntry(entry);
      save();
    }
  };
  const handleEntryClick = (entry: PresetBrowserTreeNode, event: MouseEvent): void => {
    if (busy || entryDraft) return;
    focusedEntryId = entry.id;
    browserSelection.selectFromPointer(entry.id, event, entryIds);
    if (entry.kind === 'preset') name = entry.label;
    resetConflict();
  };
  const handleEntryKey = (event: KeyboardEvent, index: number): void => {
    if (busy || entryDraft) return;
    const entry = entries[index];
    if (event.key === 'F2' && canRename(entry)) {
      event.preventDefault();
      event.stopPropagation();
      startRename(entry);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      openEntry(entry);
      return;
    }
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      event.stopPropagation();
      browserSelection.selectFromToggleKey(entry.id, event, entryIds);
      return;
    }
    const next = event.key === 'ArrowDown' ? Math.min(index + 1, entries.length - 1)
      : event.key === 'ArrowUp' ? Math.max(index - 1, 0)
        : event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : null;
    if (next !== null) {
      event.preventDefault();
      event.stopPropagation();
      const nextEntry = entries[next];
      focusedEntryId = nextEntry.id;
      browserSelection.selectFromFocusMove(nextEntry.id, event, entryIds);
      if (!event.shiftKey && !event.metaKey && !event.ctrlKey && nextEntry.kind === 'preset') {
        name = nextEntry.label;
        resetConflict();
      }
      fileList?.querySelectorAll<HTMLElement>('[data-save-entry]')[next]?.focus();
    }
  };
  const save = async (overwrite = false): Promise<void> => {
    if (!dialog.request || busy || entryDraft) return;
    const request = dialog.request;
    busy = true;
    try {
      const result = await request.save(name, folder, overwrite ? conflict : null);
      if (dialog.request !== request) return;
      if (result.status === 'saved') {
        conflict = null;
        dialog.close(result);
      } else if (result.status === 'conflict') {
        conflict = result.conflict;
        error = '';
      } else {
        conflict = null;
        error = result.status === 'error' ? result.message : i18n.t(`webSave.${result.status}`);
      }
    } catch {
      error = i18n.t('webSave.failed');
      conflict = null;
    } finally {
      busy = false;
    }
  };
  const canRename = (entry: PresetBrowserTreeNode): boolean =>
    entry.kind === 'preset' || !(dialog.request?.presetType === 'device'
      && isDeviceBrowserSystemDirectoryPath(entry.relativePath));

  const cancelEntryDraft = (): void => {
    entryDraft = null;
    error = '';
  };
  const startRename = (entry: PresetBrowserTreeNode): void => {
    entryDraft = {
      mode: 'rename',
      presetType: entry.presetType,
      source: 'user',
      entryKind: entry.kind === 'folder' ? 'directory' : 'file',
      relativePath: [...entry.relativePath],
      draftName: entry.label,
    };
    resetConflict();
  };
  const beginFolderCreate = (destination: readonly string[] = folder): void => {
    const request = dialog.request;
    if (!request || busy || entryDraft) return;
    folder = [...destination];
    browserSelection.clear();
    resetConflict();
    entryDraft = {
      mode: 'create',
      presetType: request.presetType,
      source: 'user',
      entryKind: 'directory',
      relativePath: [...destination],
      draftName: '',
    };
  };
  const commitEntryDraft = async (): Promise<void> => {
    const draft = entryDraft;
    if (!draft || busy) return;
    busy = true;
    try {
      const response = await onCommitEntryDraft(draft);
      if (response.status === 'error') {
        error = i18n.t(draft.mode === 'create' ? 'webSave.createFolderFailed' : 'webSave.renameFailed');
        return;
      }
      if (draft.entryKind === 'file') {
        name = resolvePresetNameFromFileName(response.relativePath.at(-1) ?? '', draft.presetType) ?? '';
      }
      cancelEntryDraft();
      const entry = entries.find((entry) => arePresetPathsEqual(entry.relativePath, response.relativePath));
      if (entry) {
        browserSelection.selectSingle(entry.id, entryIds);
        focusedEntryId = entry.id;
      }
    } catch {
      error = i18n.t('webSave.failed');
    } finally {
      busy = false;
    }
  };
  const openContextMenu = (event: MouseEvent, entry?: PresetBrowserTreeNode): void => {
    event.preventDefault();
    event.stopPropagation();
    const request = dialog.request;
    if (!request || busy || entryDraft) return;
    const toTarget = (node?: PresetBrowserTreeNode): PresetEntryContextTarget => ({
      kind: 'preset-entry',
      presetType: request.presetType,
      source: 'user',
      relativePath: [...(node?.relativePath ?? folder)],
      entryKind: node?.kind === 'preset' ? 'file' : 'directory',
      isSystemFolder: node ? !canRename(node) : true,
    });
    const target = toTarget(entry);
    if (entry && (!browserSelection.includes(entry.id) || target.isSystemFolder)) selectEntry(entry);
    const selectedTargets = entries.filter((node) => browserSelection.includes(node.id)).map(toTarget);
    contextMenu?.open(event.clientX, event.clientY,
      entry ? resolvePresetSelectionContextTarget(target, selectedTargets) : target);
  };
  const renameContextEntry = (target: ContextMenuTarget): void => {
    if (target.kind !== 'preset-entry') return;
    const entry = entries.find((candidate) =>
      (target.entryKind === 'directory' ? candidate.kind === 'folder' : candidate.kind === 'preset')
      && arePresetPathsEqual(candidate.relativePath, target.relativePath));
    if (entry && canRename(entry)) startRename(entry);
  };

  onMount(() => browserSelection.mountClearOnOutsidePointer('[data-save-entry]'));
  onDestroy(() => dialog.close());
</script>

{#snippet entryEditor()}
  {#if entryDraft}
    <BrowserEntryNameInput value={entryDraft.draftName}
      ariaLabel={i18n.t(entryDraft.entryKind === 'directory'
        ? 'browser.presetFolderName' : 'browser.presetFileName')}
      disabled={busy}
      onValueChange={(value) => { if (entryDraft) entryDraft.draftName = value; error = ''; }}
      onCommit={commitEntryDraft}
      onCancel={cancelEntryDraft} />
  {/if}
{/snippet}

<ModalDialog
  open={dialog.request !== null}
  title={i18n.t('webSave.title')}
  visuallyHiddenTitle
  confirmLabel={i18n.t('info.save')}
  showConfirm={!entryDraft}
  cancelLabel={i18n.t('app.cancel')}
  defaultAction={entryDraft ? 'none' : 'confirm'}
  {busy}
  onConfirm={() => save()}
  onCancel={() => dialog.close()}
>
  {#snippet footerLeading()}
    <Button class="modal-dialog-action-button" text={i18n.t('webSave.newFolder')}
      disabled={busy || entryDraft !== null}
      onClick={() => beginFolderCreate()} />
  {/snippet}
  <div class="save-fields">
    <TextField id="browser-preset-save-name" value={name} label={i18n.t('info.name')} disabled={busy}
      onValueChange={(value) => { name = value; browserSelection.clear(); resetConflict(); }} />
    <div class="file-browser">
      <div class="file-list" bind:this={fileList} role="tree" aria-multiselectable="true" tabindex="-1"
        aria-label={i18n.t('webSave.folderContents')}
        oncontextmenu={(event) => openContextMenu(event)}>
        {#each entries as entry, index (entry.id)}
          <div class="file-entry" data-save-entry
            class:is-active={browserSelection.includes(entry.id)}
            use:touchGestures={{ enabled: !busy && entryDraft === null }}
            aria-label={entry.label}
            role="treeitem"
            aria-selected={editingEntry?.id === entry.id || browserSelection.includes(entry.id)}
            aria-disabled={busy || (entryDraft !== null && editingEntry?.id !== entry.id)}
            tabindex={busy || entryDraft !== null
              ? undefined : focusedEntryId === entry.id ? 0 : -1}
            onpointerdown={(event) => {
              if (busy || entryDraft || event.button !== 0 || !event.isPrimary) return;
              focusedEntryId = entry.id;
              event.currentTarget.focus({ preventScroll: true });
              if (!event.shiftKey && !event.metaKey && !event.ctrlKey
                && !browserSelection.includes(entry.id)) selectEntry(entry);
            }}
            onclick={(event) => handleEntryClick(entry, event)}
            ondblclick={() => {
              if (busy || entryDraft) return;
              openEntry(entry);
            }}
            oncontextmenu={(event) => openContextMenu(event, entry)}
            onkeydown={(event: KeyboardEvent) => handleEntryKey(event, index)}>
            <BrowserEntryContent icon={resolvePresetBrowserEntryIcon(entry)} label={entry.label}
              trailingIcon={entry.kind === 'folder' ? 'chevron_right' : undefined}
              children={editingEntry?.id === entry.id ? entryEditor : undefined} />
          </div>
        {/each}
        {#if entryDraft?.mode === 'create'}
          <div class="file-entry is-active" data-save-entry role="treeitem" aria-selected="true">
            <BrowserEntryContent icon="folder" children={entryEditor} />
          </div>
        {/if}
      </div>
      <nav class="folder-path" aria-label={i18n.t('webSave.folder')}>
        {#each [rootLabel, ...folder] as segment, depth (depth)}
          {#if depth > 0}
            <span class="browser-chevron-icon material-symbols-rounded" aria-hidden="true">
              chevron_right
            </span>
          {/if}
          <button class="folder-path-segment" type="button" disabled={busy}
            aria-current={depth === folder.length ? 'location' : undefined}
            onclick={() => navigate(folder.slice(0, depth))}>
            <BrowserEntryContent icon="folder" label={segment} />
          </button>
        {/each}
      </nav>
    </div>
    {#if error}
      <p role="alert">{error}</p>
    {/if}
  </div>
</ModalDialog>

<ModalDialog
  open={dialog.request !== null && conflict !== null}
  title={i18n.t('webSave.overwriteTitle', { label: name.trim() })}
  description={i18n.t('webSave.conflict')}
  confirmLabel={i18n.t('webSave.overwrite')}
  cancelLabel={i18n.t('app.cancel')}
  {busy}
  defaultAction="confirm"
  onConfirm={() => save(true)}
  onCancel={() => { conflict = null; }}
/>

<ContextMenu
  bind:this={contextMenu}
  {...menuActions}
  {platform}
  {browserClipboardPresetType}
  onRename={renameContextEntry}
  onCreatePresetFolder={(target) => beginFolderCreate(target.relativePath)}
/>

<style lang="scss">
  .save-fields { display: grid; gap: var(--gap-12); }
  .file-browser {
    overflow: hidden;
    border: 1px solid var(--color-border-floating);
    border-radius: var(--radius-8);
  }
  .file-list {
    height: 10rem;
    overflow: auto;
    padding: var(--gap-4);
  }
  .file-entry {
    display: flex;
    align-items: center;
    min-width: 0;
    height: 1.5rem;
    padding-inline: var(--gap-2);
    touch-action: pan-y pinch-zoom;
    -webkit-touch-callout: none;
    outline: none;
    cursor: pointer;
    border-radius: var(--radius-4);
    font-size: var(--text-12);
  }
  .file-entry:hover { background: var(--color-surface-interactive); }
  .file-entry.is-active { background: var(--color-surface-active); }
  .file-entry.is-active + .file-entry.is-active {
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }
  .file-entry.is-active:has(+ .file-entry.is-active) {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
  .folder-path {
    display: flex;
    align-items: center;
    gap: var(--gap-4);
    min-width: 0;
    overflow-x: auto;
    padding: var(--gap-2) var(--gap-6);
    border-top: 1px solid var(--color-border-floating);
    color: var(--color-text-tertiary);
  }
  .folder-path > .browser-chevron-icon {
    margin-right: var(--gap-neg-4);
  }
  .folder-path-segment {
    --browser-icon-accent: var(--color-text-tertiary);

    display: flex;
    align-items: center;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--text-12);
  }
  p { margin: 0; font-size: var(--text-13); }
</style>
