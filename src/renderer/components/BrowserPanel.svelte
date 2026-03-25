<script lang="ts">
  import { tick } from 'svelte';

  import type { RendererDeviceKind } from '../../devices';
  import type { PresetFileKind } from '../../shared/presets';
  import { getDeviceBrowserIcon } from '../features/editor/device-browser-categories';
  import Button from './Button.svelte';
  import SidebarSettingsPage from './SidebarSettingsPage.svelte';
  import type {
    BrowserTreeDeviceLeafNode,
    BrowserTreeDeviceFolderNode,
    BrowserTreeNode,
    PendingPresetFolderDraft,
    PresetFolderSelectionTarget,
    BrowserTreePresetLeafNode,
    BrowserTreePresetFolderNode,
  } from './browser-tree-types';
  import type { ContextMenuTarget } from './context-menu-types';
  import type { BrowserInsertSource } from './device-rack-types';

  export type BrowserPanelPage = 'devices' | 'presets' | 'settings';

  interface VisibleTreeRow {
    node: VisibleBrowserTreeNode;
    level: number;
    parentId: string | null;
    posInSet: number;
    setSize: number;
  }

  interface PendingPresetFolderNode {
    kind: 'folder';
    treeKind: 'preset';
    id: string;
    label: string;
    presetType: PresetFileKind;
    relativePath: string[];
    children: [];
    isPending: true;
  }

  type VisibleBrowserTreeNode = BrowserTreeNode | PendingPresetFolderNode;

  type BrowserPointerDownPayload = {
    source: BrowserInsertSource;
    badgeLabel: string;
    sourceEvent: PointerEvent;
    itemEl: HTMLElement;
  };

  type PresetContextMenuTarget = Extract<
    ContextMenuTarget,
    { kind: 'preset-entry' | 'presets-root' }
  >;

  const areEqualRelativePaths = (
    left: readonly string[],
    right: readonly string[],
  ): boolean =>
    left.length === right.length && left.every((segment, index) => segment === right[index]);

  const buildPendingPresetFolderNode = (
    draft: PendingPresetFolderDraft,
  ): PendingPresetFolderNode => ({
    kind: 'folder',
    treeKind: 'preset',
    id: draft.temporaryId ?? '',
    label: draft.draftName,
    presetType: draft.presetType,
    relativePath: [...draft.relativePath, draft.draftName.trim()],
    children: [],
    isPending: true,
  });

  const resolvePresetFolderNodeId = (
    presetType: PresetFileKind,
    relativePath: readonly string[],
  ): string =>
    relativePath.length === 0
      ? `preset-root:${presetType}`
      : `preset:${presetType}:${relativePath.join('/')}`;

  const isPendingPresetFolderRow = (
    node: VisibleBrowserTreeNode,
  ): node is PendingPresetFolderNode =>
    node.kind === 'folder' && 'isPending' in node && node.isPending;

  const isEditingPresetFolderRow = (
    node: VisibleBrowserTreeNode,
    draft: PendingPresetFolderDraft | null,
  ): boolean => {
    if (!draft || node.kind !== 'folder' || node.treeKind !== 'preset') {
      return false;
    }

    if (draft.mode === 'create') {
      return isPendingPresetFolderRow(node);
    }

    return !isPendingPresetFolderRow(node)
      && node.presetType === draft.presetType
      && areEqualRelativePaths(node.relativePath, draft.relativePath);
  };

  const insertPendingPresetFolder = (
    roots: readonly BrowserTreePresetFolderNode[],
    draft: PendingPresetFolderDraft | null,
  ): BrowserTreePresetFolderNode[] => {
    if (!draft || draft.mode !== 'create') {
      return roots.map((root) => ({
        ...root,
        children: [...root.children],
      }));
    }

    const pendingNode = buildPendingPresetFolderNode(draft);
    const cloneFolderNode = (
      node: BrowserTreePresetFolderNode,
    ): BrowserTreePresetFolderNode => ({
      ...node,
      children: node.children.map((child) =>
        child.kind === 'folder' && child.treeKind === 'preset'
          ? cloneFolderNode(child)
          : child),
    });

    const nextRoots = roots.map((root) => cloneFolderNode(root));
    const rootNode = nextRoots.find((root) => root.presetType === draft.presetType);
    if (!rootNode) {
      return nextRoots;
    }

    if (draft.relativePath.length === 0) {
      rootNode.children = [...rootNode.children, pendingNode];
      return nextRoots;
    }

    const visit = (node: BrowserTreePresetFolderNode): boolean => {
      if (
        node.presetType === draft.presetType
        && areEqualRelativePaths(node.relativePath, draft.relativePath)
      ) {
        node.children = [...node.children, pendingNode];
        return true;
      }

      for (const child of node.children) {
        if (child.kind !== 'folder' || child.treeKind !== 'preset') {
          continue;
        }
        if (visit(child)) {
          return true;
        }
      }

      return false;
    };

    visit(rootNode);
    return nextRoots;
  };

  const collectVisibleRows = (
    nodes: readonly VisibleBrowserTreeNode[],
    expandedFolderIdSet: ReadonlySet<string>,
    level = 1,
    parentId: string | null = null,
  ): VisibleTreeRow[] => {
    const rows: VisibleTreeRow[] = [];

    nodes.forEach((node, index) => {
      rows.push({
        node,
        level,
        parentId,
        posInSet: index + 1,
        setSize: nodes.length,
      });

      if (node.kind === 'folder' && expandedFolderIdSet.has(node.id)) {
        rows.push(
          ...collectVisibleRows(
            node.children,
            expandedFolderIdSet,
            level + 1,
            node.id,
          ),
        );
      }
    });

    return rows;
  };

  const treeItemRefs: Record<string, HTMLDivElement | undefined> = {};

  const registerTreeItem = (element: HTMLDivElement, nodeId: string) => {
    treeItemRefs[nodeId] = element;

    return {
      destroy() {
        delete treeItemRefs[nodeId];
      },
    };
  };

  let {
    activePage = 'devices',
    deviceTree = [] as BrowserTreeDeviceFolderNode[],
    presetTree = [] as BrowserTreePresetFolderNode[],
    isPresetLoading = false,
    presetErrorText = null,
    pendingPresetFolderDraft = null,
    presetFolderSelectionTarget = null,
    launchpadMk2Enabled = false,
    paletteDescription = 'Default palette',
    paletteDescriptionTone = 'neutral',
    appVersionText = '',
    aboutDescription = '',
    aboutDescriptionTone = 'neutral',
    onPageSelect = () => {},
    onDeviceAdd,
    onBrowserPointerDown,
    onOpenContextMenu = () => {},
    onLaunchpadModelToggle = () => {},
    onPaletteReset = () => {},
    onPaletteFileChange = () => {},
    onOpenAboutSite = () => {},
    onPresetEntryOpen,
    onPresetFilePointerDown,
    onPendingPresetFolderDraftNameChange = () => {},
    onPendingPresetFolderDraftCommit = () => {},
    onPendingPresetFolderDraftCancel = () => {},
    onPresetFolderSelectionHandled = () => {},
  } = $props<{
    activePage?: BrowserPanelPage;
    deviceTree: BrowserTreeDeviceFolderNode[];
    presetTree: BrowserTreePresetFolderNode[];
    isPresetLoading?: boolean;
    presetErrorText?: string | null;
    pendingPresetFolderDraft?: PendingPresetFolderDraft | null;
    presetFolderSelectionTarget?: PresetFolderSelectionTarget | null;
    launchpadMk2Enabled?: boolean;
    paletteDescription?: string;
    paletteDescriptionTone?: 'neutral' | 'error';
    appVersionText?: string;
    aboutDescription?: string;
    aboutDescriptionTone?: 'neutral' | 'error';
    onPageSelect?: (page: BrowserPanelPage) => void;
    onDeviceAdd: (kind: RendererDeviceKind) => void;
    onBrowserPointerDown: (payload: BrowserPointerDownPayload) => void;
    onOpenContextMenu?: (
      clientX: number,
      clientY: number,
      target: ContextMenuTarget,
    ) => void;
    onLaunchpadModelToggle?: (enabled: boolean) => void;
    onPaletteReset?: () => void;
    onPaletteFileChange?: (event: Event) => void | Promise<void>;
    onOpenAboutSite?: () => void | Promise<void>;
    onPresetEntryOpen: (entry: BrowserTreePresetLeafNode) => void | Promise<void>;
    onPresetFilePointerDown: (
      entry: BrowserTreePresetLeafNode,
      event: PointerEvent,
      itemEl: HTMLElement,
    ) => void | Promise<void>;
    onPendingPresetFolderDraftNameChange?: (nextName: string) => void;
    onPendingPresetFolderDraftCommit?: () => void | Promise<void>;
    onPendingPresetFolderDraftCancel?: () => void;
    onPresetFolderSelectionHandled?: (token: number) => void;
  }>();

  let expandedFolderIds = $state<string[]>([]);
  let initializedRootFolderIds = $state<string[]>([]);
  let selectedRowId = $state<string | null>(null);
  let pendingPresetFolderInputEl = $state<HTMLInputElement | null>(null);
  let skipPendingPresetFolderBlurId = $state<string | null>(null);

  const activeTreeRoots = $derived.by(() => {
    if (activePage === 'devices') {
      return deviceTree;
    }

    if (activePage === 'presets') {
      return insertPendingPresetFolder(presetTree, pendingPresetFolderDraft);
    }

    return [];
  });
  const expandedFolderIdSet = $derived.by(() => new Set(expandedFolderIds));
  const visibleRows = $derived.by(() =>
    collectVisibleRows(activeTreeRoots, expandedFolderIdSet));

  const isFolderExpanded = (folderId: string): boolean =>
    expandedFolderIdSet.has(folderId);

  const selectRow = (rowId: string): void => {
    selectedRowId = rowId;
  };

  const focusRow = async (rowId: string): Promise<void> => {
    selectedRowId = rowId;
    await tick();
    treeItemRefs[rowId]?.focus();
  };

  const toggleFolder = (folderId: string): void => {
    if (expandedFolderIdSet.has(folderId)) {
      expandedFolderIds = expandedFolderIds.filter((id) => id !== folderId);
      return;
    }

    expandedFolderIds = [...expandedFolderIds, folderId];
  };

  const resolveRowIndex = (rowId: string): number =>
    visibleRows.findIndex((row) => row.node.id === rowId);

  const resolveLeafIcon = (node: BrowserTreeDeviceLeafNode | BrowserTreePresetLeafNode): string => {
    if (node.kind === 'device') {
      return getDeviceBrowserIcon(node.deviceKind);
    }

    if (node.presetType === 'group') {
      return 'stacks';
    }

    if (node.presetType === 'rack') {
      return 'view_week';
    }

    return 'tune';
  };

  const handleLeafPointerDown = (
    node: BrowserTreeDeviceLeafNode | BrowserTreePresetLeafNode,
    event: PointerEvent,
  ): void => {
    const itemEl = event.currentTarget;
    if (!(itemEl instanceof HTMLElement)) {
      return;
    }

    if (node.kind === 'device') {
      onBrowserPointerDown({
        source: {
          kind: 'device-kind',
          deviceKind: node.deviceKind,
        },
        badgeLabel: `+ ${node.label}`,
        sourceEvent: event,
        itemEl,
      });
      return;
    }

    void onPresetFilePointerDown(node, event, itemEl);
  };

  const handleLeafDoubleClick = (
    node: BrowserTreeDeviceLeafNode | BrowserTreePresetLeafNode,
  ): void => {
    if (node.kind === 'device') {
      onDeviceAdd(node.deviceKind);
      return;
    }

    void onPresetEntryOpen(node);
  };

  const resolvePresetContextMenuTarget = (
    node: VisibleBrowserTreeNode,
  ): PresetContextMenuTarget | null => {
    if (node.kind === 'folder' && 'isPending' in node && node.isPending) {
      return null;
    }

    if (node.kind === 'preset') {
      return {
        kind: 'preset-entry',
        presetType: node.presetType,
        relativePath: [...node.relativePath],
        entryKind: 'file',
      };
    }

    if (node.kind === 'folder' && node.treeKind === 'preset') {
      return {
        kind: 'preset-entry',
        presetType: node.presetType,
        relativePath: [...node.relativePath],
        entryKind: 'directory',
      };
    }

    return null;
  };

  const handleTreeItemContextMenu = (
    node: VisibleBrowserTreeNode,
    event: MouseEvent,
  ): void => {
    const target = resolvePresetContextMenuTarget(node);
    if (!target) {
      return;
    }

    event.preventDefault();
    selectRow(node.id);
    onOpenContextMenu(event.clientX, event.clientY, target);
  };

  const handleTreeItemKeyDown = async (
    row: VisibleTreeRow,
    event: KeyboardEvent,
  ): Promise<void> => {
    const rowIndex = resolveRowIndex(row.node.id);
    if (rowIndex < 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      const nextRow = visibleRows[rowIndex + 1];
      if (nextRow) {
        event.preventDefault();
        await focusRow(nextRow.node.id);
      }
      return;
    }

    if (event.key === 'ArrowUp') {
      const prevRow = visibleRows[rowIndex - 1];
      if (prevRow) {
        event.preventDefault();
        await focusRow(prevRow.node.id);
      }
      return;
    }

    if (event.key === 'ArrowRight') {
      if (row.node.kind !== 'folder') {
        return;
      }

      event.preventDefault();
      if (!isFolderExpanded(row.node.id)) {
        toggleFolder(row.node.id);
        return;
      }

      const nextRow = visibleRows[rowIndex + 1];
      if (nextRow && nextRow.parentId === row.node.id) {
        await focusRow(nextRow.node.id);
      }
      return;
    }

    if (event.key === 'ArrowLeft') {
      if (row.node.kind === 'folder' && isFolderExpanded(row.node.id)) {
        event.preventDefault();
        toggleFolder(row.node.id);
        return;
      }

      if (row.parentId) {
        event.preventDefault();
        await focusRow(row.parentId);
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (row.node.kind === 'folder') {
        toggleFolder(row.node.id);
        return;
      }

      handleLeafDoubleClick(row.node);
    }
  };

  const handleDragStart = (event: DragEvent): void => {
    event.preventDefault();
  };

  const handlePendingPresetFolderDraftCommit = (): void => {
    void onPendingPresetFolderDraftCommit();
  };

  const handlePendingPresetFolderDraftBlur = (rowId: string): void => {
    if (skipPendingPresetFolderBlurId === rowId) {
      skipPendingPresetFolderBlurId = null;
      return;
    }

    if ((pendingPresetFolderDraft?.draftName.trim() ?? '').length === 0) {
      onPendingPresetFolderDraftCancel();
      return;
    }

    handlePendingPresetFolderDraftCommit();
  };

  $effect(() => {
    const nextRootIds = [...deviceTree, ...presetTree]
      .map((node) => node.id)
      .filter((id) => !initializedRootFolderIds.includes(id));
    if (nextRootIds.length === 0) {
      return;
    }

    initializedRootFolderIds = [...initializedRootFolderIds, ...nextRootIds];
    expandedFolderIds = [...expandedFolderIds, ...nextRootIds];
  });

  $effect(() => {
    const firstVisibleRowId = visibleRows[0]?.node.id ?? null;
    if (!firstVisibleRowId) {
      selectedRowId = null;
      return;
    }

    if (!selectedRowId || resolveRowIndex(selectedRowId) === -1) {
      selectedRowId = firstVisibleRowId;
    }
  });

  $effect(() => {
    const draft = pendingPresetFolderDraft;
    if (!draft) {
      return;
    }

    const ancestorRelativePath = draft.mode === 'create'
      ? draft.relativePath
      : draft.relativePath.slice(0, -1);
    const ancestorIds = [
      `preset-root:${draft.presetType}`,
      ...ancestorRelativePath.map((_segment: string, index: number) =>
        `preset:${draft.presetType}:${ancestorRelativePath.slice(0, index + 1).join('/')}`),
    ];
    const nextExpandedFolderIds = Array.from(new Set([...expandedFolderIds, ...ancestorIds]));
    const didExpandFolders = nextExpandedFolderIds.length !== expandedFolderIds.length;
    if (didExpandFolders) {
      expandedFolderIds = nextExpandedFolderIds;
    }

    const targetRowId = draft.mode === 'create'
      ? draft.temporaryId ?? ''
      : resolvePresetFolderNodeId(draft.presetType, draft.relativePath);
    const didSelectPendingRow = selectedRowId !== targetRowId;
    if (didSelectPendingRow) {
      selectedRowId = targetRowId;
    }

    if (didExpandFolders || didSelectPendingRow) {
      void tick().then(() => {
        pendingPresetFolderInputEl?.focus();
        pendingPresetFolderInputEl?.select();
      });
    }
  });

  $effect(() => {
    const selectionTarget = presetFolderSelectionTarget;
    if (!selectionTarget || activePage !== 'presets') {
      return;
    }

    const match = visibleRows.find((row) =>
      row.node.kind === 'folder'
      && row.node.treeKind === 'preset'
      && row.node.presetType === selectionTarget.presetType
      && areEqualRelativePaths(row.node.relativePath, selectionTarget.relativePath));
    if (!match) {
      return;
    }

    void focusRow(match.node.id).then(() => {
      onPresetFolderSelectionHandled(selectionTarget.token);
    });
  });
</script>

<aside class="browser-panel">
  <div class="browser-view">
    <div class="browser-page-switch">
      <div class="browser-page-switch-group">
        <Button
          class="browser-page-switch-button"
          variant="icon"
          label="Devices"
          icon="widgets"
          pressed={activePage === 'devices'}
          onClick={() => onPageSelect('devices')}
        />
        <Button
          class="browser-page-switch-button"
          variant="icon"
          label="Presets"
          icon="inventory_2"
          pressed={activePage === 'presets'}
          onClick={() => onPageSelect('presets')}
          oncontextmenu={(event: MouseEvent) => {
            event.preventDefault();
            onOpenContextMenu(event.clientX, event.clientY, {
              kind: 'presets-root',
            });
          }}
        />
      </div>
      <div class="browser-page-switch-group">
        <Button
          class="browser-page-switch-button"
          variant="icon"
          label="Settings"
          icon="settings"
          pressed={activePage === 'settings'}
          onClick={() => onPageSelect('settings')}
        />
      </div>
    </div>

    <div class="browser-page-panel">
      {#if activePage === 'settings'}
        <SidebarSettingsPage
          {launchpadMk2Enabled}
          {paletteDescription}
          {paletteDescriptionTone}
          {appVersionText}
          {aboutDescription}
          {aboutDescriptionTone}
          onLaunchpadModelToggle={onLaunchpadModelToggle}
          onPaletteReset={onPaletteReset}
          onPaletteFileChange={onPaletteFileChange}
          onOpenAboutSite={onOpenAboutSite}
        />
      {:else if activePage === 'presets' && isPresetLoading}
        <p class="browser-status">Loading presets...</p>
      {:else if activePage === 'presets' && presetErrorText}
        <p class="browser-status browser-status-error">{presetErrorText}</p>
      {:else}
        <ul
          class="browser-tree-list browser-tree-root"
          role="tree"
          aria-label={activePage === 'devices' ? 'Devices browser' : 'Presets browser'}
        >
          {#each visibleRows as row (row.node.id)}
            <li role="none" class:is-selected={selectedRowId === row.node.id}>
              <div
                use:registerTreeItem={row.node.id}
                class="browser-tree-item"
                style={`--browser-tree-level:${row.level};`}
                role="treeitem"
                aria-level={row.level}
                aria-posinset={row.posInSet}
                aria-setsize={row.setSize}
                aria-selected={selectedRowId === row.node.id}
                aria-expanded={row.node.kind === 'folder' ? isFolderExpanded(row.node.id) : undefined}
                tabindex={selectedRowId === row.node.id ? 0 : -1}
                ondragstart={handleDragStart}
                onclick={() => selectRow(row.node.id)}
                ondblclick={() => {
                  selectRow(row.node.id);
                  if (row.node.kind === 'folder') {
                    toggleFolder(row.node.id);
                    return;
                  }

                  handleLeafDoubleClick(row.node);
                }}
                onkeydown={(event) => void handleTreeItemKeyDown(row, event)}
                onpointerdown={(event) => {
                  selectRow(row.node.id);
                  if (row.node.kind === 'folder') {
                    return;
                  }

                  handleLeafPointerDown(row.node, event);
                }}
                oncontextmenu={(event) => handleTreeItemContextMenu(row.node, event)}
              >
                {#if row.node.kind === 'folder'}
                  <button
                    class="browser-tree-leading-slot browser-tree-chevron"
                    type="button"
                    aria-label={isFolderExpanded(row.node.id) ? 'Collapse folder' : 'Expand folder'}
                    tabindex="-1"
                    onclick={(event) => {
                      event.stopPropagation();
                      selectRow(row.node.id);
                      toggleFolder(row.node.id);
                    }}
                  >
                    <span class="material-symbols-rounded" aria-hidden="true">
                      {isFolderExpanded(row.node.id) ? 'expand_more' : 'chevron_right'}
                    </span>
                  </button>
                {:else}
                  <span class="browser-tree-leading-slot browser-tree-item-icon material-symbols-rounded" aria-hidden="true">
                    {resolveLeafIcon(row.node)}
                  </span>
                {/if}
                {#if isEditingPresetFolderRow(row.node, pendingPresetFolderDraft)}
                  <input
                    bind:this={pendingPresetFolderInputEl}
                    class="browser-tree-item-input"
                    type="text"
                    value={pendingPresetFolderDraft?.draftName ?? ''}
                    aria-label="New preset folder name"
                    onpointerdown={(event) => event.stopPropagation()}
                    onclick={(event) => event.stopPropagation()}
                    ondblclick={(event) => event.stopPropagation()}
                    oninput={(event) => {
                      const target = event.currentTarget;
                      if (!(target instanceof HTMLInputElement)) {
                        return;
                      }
                      onPendingPresetFolderDraftNameChange(target.value);
                    }}
                    onkeydown={(event) => {
                      event.stopPropagation();
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        skipPendingPresetFolderBlurId = row.node.id;
                        handlePendingPresetFolderDraftCommit();
                        return;
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        skipPendingPresetFolderBlurId = row.node.id;
                        onPendingPresetFolderDraftCancel();
                      }
                    }}
                    onblur={() => handlePendingPresetFolderDraftBlur(row.node.id)}
                  />
                {:else}
                  <span class="browser-tree-item-label">{row.node.label}</span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</aside>

<style lang="scss">
  .browser-panel {
    display: flex;
    flex-direction: column;
    flex: 0 0 var(--browser-panel-width, var(--sidebar-width));
    min-width: 0;
    min-height: 0;
    padding: var(--gap-10);
    background: var(--neutral-10);

    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      width: var(--browser-panel-width, var(--sidebar-width));
      height: var(--gap-48);
      -webkit-app-region: drag;
      z-index: -1;
    }
  }

  .browser-view {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    margin-top: var(--gap-32);
    display: flex;
    gap: var(--gap-10);
  }

  .browser-page-switch {
    display: flex;
    flex-direction: column;
    align-self: stretch;
    min-height: 0;
    justify-content: space-between;
    -webkit-app-region: no-drag;

    &-group {
      display: flex;
      flex-direction: column;
      gap: var(--gap-6);
    }

    &-button {
      color: var(--neutral-50);
    }
  }

  .browser-page-panel {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-app-region: no-drag;
  }

  .browser-tree-list {
    margin: 0;
    padding: 0;
    list-style: none;

    li.is-selected {
      background: var(--neutral-20);
      border-radius: var(--radius-4);
    }
  }

  .browser-tree-leading-slot {
    width: 1.5rem;
    height: 1.5rem;
    flex: 0 0 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .browser-tree-chevron {
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--neutral-50);
    cursor: pointer;

    .material-symbols-rounded {
      font-size: var(--text-16);
      line-height: 1;
      font-variation-settings: 'FILL' 1, 'wght' 400;
    }
  }

  .browser-tree-item {
    min-width: 0;
    padding: {
      block: 0;
      left: calc((var(--browser-tree-level, 1) - 1) * var(--gap-12));
      right: var(--gap-2);
    }
    border-radius: var(--radius-4);
    display: flex;
    align-items: center;
    font-size: var(--text-12);
    cursor: pointer;

    &:focus-visible {
      outline: none;
    }

    &:global(.is-dragging) {
      opacity: 0.7;
    }

    &-icon {
      font-size: var(--text-14);
      line-height: 1;
      color: var(--neutral-50);
      font-variation-settings: 'FILL' 1, 'wght' 400;
    }

    &-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &-input {
      min-width: 0;
      width: 100%;
      font: inherit;
    }
  }

  .browser-status {
    font-size: var(--text-12);
    color: var(--neutral-50);

    &-error {
      color: var(--accent-500);
    }
  }
</style>
