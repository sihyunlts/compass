<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';

  import type { RendererDeviceKind } from '../../../devices';
  import type { AppLocale } from '../../../shared/i18n';
  import {
    isPresetFileKind,
    type PresetFileKind,
    type RackPresetFile,
  } from '../../../shared/presets';
  import {
    canMovePresetEntriesTo,
  } from '../../../shared/preset-entry-move';
  import {
    arePresetPathsEqual as areEqualRelativePaths,
    normalizePresetEntrySelection,
    type PresetEntryPath,
  } from '../../../shared/preset-entry-selection';
  import {
    getDeviceBrowserCategory,
    getDeviceBrowserCategoryAccentColorVar,
    getDeviceBrowserCategoryIcon,
    getDeviceBrowserIcon,
    mergeDevicePresetTree,
  } from '../../features/editor/device-browser-categories';
  import Button from '../primitives/Button.svelte';
  import SidebarSettingsPage from './SidebarSettingsPage.svelte';
  import type {
    BrowserPage,
    BrowserTreeDeviceFolderNode,
    BrowserTreeDeviceNode,
    BrowserTreeNode,
    PendingPresetFolderDraft,
    PresetEntrySelectionTarget,
    BrowserTreePresetLeafNode,
    BrowserTreePresetFolderNode,
  } from '../../features/browser/types';
  import type {
    ContextMenuTarget,
    PresetBrowserContextTarget,
    PresetEntryContextTarget,
  } from '../../features/context-menu/types';
  import type { BrowserInsertSource } from '../../features/rack/types';
  import type {
    ThemePresetId,
    ThemeSelectionId,
  } from '../../theme-presets';
  import { i18n } from '../../i18n.svelte';
  import {
    getDeviceCategoryMessageKey,
    getDeviceMessageKey,
  } from '../../device-i18n';
  import { createBrowserSelection } from '../../features/browser/selection.svelte';
  import {
    BrowserPresetMoveDrag,
    type BrowserPresetMoveDestination,
  } from '../../features/browser/preset-move-drag.svelte';
  import type { BrowserDragBadgeContent } from '../../features/browser/drag-badge';
  import { hasAdditiveSelectionModifier } from '../../features/selection/ordered-selection';
  import { createPresetPreviewHintController } from '../../features/browser/preset-preview-hint';
  import { resolvePresetFileErrorMessage } from '../../features/browser/preset-file-error';
  import { hint, type HintInput } from '../overlays/hint';

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
    entryKind: 'directory';
    presetType: PresetFileKind;
    source: 'user';
    icon?: string;
    relativePath: string[];
    children: [];
    isPending: true;
  }

  type VisibleBrowserTreeNode = BrowserTreeNode | PendingPresetFolderNode;

  const presetPreviewHintController = createPresetPreviewHintController();

  onDestroy(() => presetPreviewHintController.dispose());

  const PRESET_PAGE_BY_TYPE = {
    device: 'devices',
    group: 'groups',
    rack: 'racks',
  } as const;

  const PRESET_TYPE_BY_PAGE = {
    devices: 'device',
    groups: 'group',
    racks: 'rack',
  } as const;

  const resolvePresetPreviewHint = (
    node: VisibleBrowserTreeNode,
    paletteRevision: number,
    resolvePaletteRgb: (velocity: number) => string,
  ): HintInput => {
    if (node.kind === 'folder') {
      return null;
    }

    if (node.kind === 'preset' && node.loadStatus === 'error') {
      return {
        text: resolvePresetFileErrorMessage(node.loadErrorCode),
        placement: 'adjacent',
      };
    }

    return presetPreviewHintController.resolveHint(
      node,
      paletteRevision,
      launchpadMk2Enabled ? 'mk2' : 'mk3',
      resolvePaletteRgb,
      onRackPresetPreviewLoad,
    );
  };

  const hasTreeNodeChildren = (
    node: VisibleBrowserTreeNode,
  ): node is VisibleBrowserTreeNode & { children: BrowserTreeNode[] } =>
    'children' in node && node.children.length > 0;

  const canExpandTreeNode = (
    node: VisibleBrowserTreeNode,
  ): boolean => node.kind === 'folder' || hasTreeNodeChildren(node);

  type BrowserPointerDownPayload = {
    source: BrowserInsertSource;
    badgeLabel: string;
    sourceEvent: PointerEvent;
    itemEl: HTMLElement;
  };

  const buildPendingPresetFolderNode = (
    draft: PendingPresetFolderDraft,
  ): PendingPresetFolderNode => ({
    kind: 'folder',
    treeKind: 'preset',
    id: draft.temporaryId ?? '',
    label: draft.draftName,
    entryKind: 'directory',
    presetType: draft.presetType,
    source: draft.source,
    relativePath: [...draft.relativePath, draft.draftName.trim()],
    children: [],
    isPending: true,
  });

  const resolvePresetNodeId = (
    presetType: PresetFileKind,
    relativePath: readonly string[],
  ): string =>
    relativePath.length === 0
      ? `preset-root:${presetType}`
      : `preset:${presetType}:${relativePath.join('/')}`;

  const resolvePresetDirectoryNodeId = (
    presetType: PresetFileKind,
    relativePath: readonly string[],
  ): string => {
    if (presetType === 'device') {
      for (const category of deviceTree) {
        if (areEqualRelativePaths(category.presetRelativePath, relativePath)) {
          return category.id;
        }

        const device = category.children.find(
          (node: BrowserTreeNode): node is BrowserTreeDeviceNode =>
            node.kind === 'device'
            && areEqualRelativePaths(node.presetRelativePath, relativePath),
        );
        if (device) {
          return device.id;
        }
      }
    }

    return resolvePresetNodeId(presetType, relativePath);
  };

  const resolveBrowserPageForPresetType = (
    presetType: PresetFileKind,
  ): Exclude<BrowserPage, 'settings'> => PRESET_PAGE_BY_TYPE[presetType];

  const resolvePresetTypeForPage = (
    page: BrowserPage,
  ): PresetFileKind | null =>
    page === 'settings' ? null : PRESET_TYPE_BY_PAGE[page];

  const isPendingPresetFolderRow = (
    node: VisibleBrowserTreeNode,
  ): node is PendingPresetFolderNode =>
    node.kind === 'folder' && 'isPending' in node && node.isPending;

  const isEditingPresetFolderRow = (
    node: VisibleBrowserTreeNode,
    draft: PendingPresetFolderDraft | null,
  ): boolean => {
    if (!draft) {
      return false;
    }

    if (draft.entryKind === 'file') {
      return node.kind === 'preset'
        && node.presetType === draft.presetType
        && areEqualRelativePaths(node.relativePath, draft.relativePath);
    }

    if (node.kind !== 'folder' || node.treeKind !== 'preset') {
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
    if (!draft || draft.mode !== 'create' || draft.entryKind !== 'directory') {
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

      if (hasTreeNodeChildren(node) && expandedFolderIdSet.has(node.id)) {
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
    presetOccupiedPaths = [] as PresetEntryPath[],
    presetErrorText = null,
    pendingPresetFolderDraft = null,
    presetEntrySelectionTarget = null,
    reserveTitlebarSpace = true,
    canToggleWindowLayer = false,
    mainWindowAlwaysOnTop = false,
    reduceAnimation = false,
    themePreset = 'default',
    themeHue = 265,
    themeSaturation = 100,
    launchpadMk2Enabled = false,
    locale = 'en',
    paletteDescription = 'Default palette',
    paletteRevision = 0,
    resolvePaletteRgb = () => '0 0 0',
    appVersionText = '',
    updateCheckText = '',
    updateAvailable = false,
    aboutDescription = '',
    aboutDescriptionTone = 'neutral',
    githubDescription = '',
    onPageSelect = () => {},
    onMainWindowAlwaysOnTopToggle = () => {},
    onReduceAnimationToggle = () => {},
    onThemePresetChange = () => {},
    onThemeHueChange = () => {},
    onThemeSaturationChange = () => {},
    onDeviceAdd,
    onBrowserPointerDown,
    onOpenContextMenu = () => {},
    onLaunchpadModelToggle = () => {},
    onLocaleChange = () => {},
    onPaletteReset = () => {},
    onPaletteFileChange = () => {},
    onOpenAboutSite = () => {},
    onOpenGitHub = () => {},
    onOpenLatestReleasePage = () => {},
    onPresetEntryOpen,
    onRackPresetPreviewLoad = async (): Promise<RackPresetFile | null> => null,
    onPresetFilePointerDown,
    onPendingPresetFolderDraftNameChange = () => {},
    onPendingPresetFolderDraftCommit = () => {},
    onPendingPresetFolderDraftCancel = () => {},
    onPresetEntriesMove = () => {},
    onPresetEntrySelectionHandled = () => {},
  } = $props<{
    activePage?: BrowserPage;
    deviceTree: BrowserTreeDeviceFolderNode[];
    presetTree: BrowserTreePresetFolderNode[];
    presetOccupiedPaths?: PresetEntryPath[];
    presetErrorText?: string | null;
    pendingPresetFolderDraft?: PendingPresetFolderDraft | null;
    presetEntrySelectionTarget?: PresetEntrySelectionTarget | null;
    reserveTitlebarSpace?: boolean;
    canToggleWindowLayer?: boolean;
    mainWindowAlwaysOnTop?: boolean;
    reduceAnimation?: boolean;
    themePreset?: ThemeSelectionId;
    themeHue?: number;
    themeSaturation?: number;
    launchpadMk2Enabled?: boolean;
    locale?: AppLocale;
    paletteDescription?: string;
    paletteRevision?: number;
    resolvePaletteRgb?: (velocity: number) => string;
    appVersionText?: string;
    updateCheckText?: string;
    updateAvailable?: boolean;
    aboutDescription?: string;
    aboutDescriptionTone?: 'neutral' | 'error';
    githubDescription?: string;
    onPageSelect?: (page: BrowserPage) => void;
    onMainWindowAlwaysOnTopToggle?: () => void;
    onReduceAnimationToggle?: (enabled: boolean) => void;
    onThemePresetChange?: (presetId: ThemePresetId) => void;
    onThemeHueChange?: (hue: number) => void;
    onThemeSaturationChange?: (saturation: number) => void;
    onDeviceAdd: (kind: RendererDeviceKind) => void;
    onBrowserPointerDown: (payload: BrowserPointerDownPayload) => void;
    onOpenContextMenu?: (
      clientX: number,
      clientY: number,
      target: ContextMenuTarget,
    ) => void;
    onLaunchpadModelToggle?: (enabled: boolean) => void;
    onLocaleChange?: (locale: AppLocale) => void;
    onPaletteReset?: () => void;
    onPaletteFileChange?: (event: Event) => void | Promise<void>;
    onOpenAboutSite?: () => void | Promise<void>;
    onOpenGitHub?: () => void | Promise<void>;
    onOpenLatestReleasePage?: () => void | Promise<void>;
    onPresetEntryOpen: (entry: BrowserTreePresetLeafNode) => void | Promise<void>;
    onRackPresetPreviewLoad?: (
      entry: BrowserTreePresetLeafNode,
    ) => Promise<RackPresetFile | null>;
    onPresetFilePointerDown: (
      entry: BrowserTreePresetLeafNode,
      event: PointerEvent,
      itemEl: HTMLElement,
      dragSignal: AbortSignal,
    ) => void | Promise<void>;
    onPendingPresetFolderDraftNameChange?: (nextName: string) => void;
    onPendingPresetFolderDraftCommit?: () => void | Promise<void>;
    onPendingPresetFolderDraftCancel?: () => void;
    onPresetEntriesMove?: (
      entries: readonly PresetEntryContextTarget[],
      destination: BrowserPresetMoveDestination,
    ) => void | Promise<void>;
    onPresetEntrySelectionHandled?: (token: number) => void;
  }>();

  let expandedFolderIds = $state<string[]>([]);
  let initializedRootFolderIds = $state<string[]>([]);
  const browserSelection = createBrowserSelection();
  let focusedRowId = $state<string | null>(null);
  let detachedKeyboardFocusRowId = $state<string | null>(null);
  let pendingPresetFolderInputEl = $state<HTMLInputElement | null>(null);
  let skipPendingPresetFolderBlurId = $state<string | null>(null);
  let focusedPresetDraftKey = $state<string | null>(null);
  let browserPagePanelEl = $state<HTMLDivElement | null>(null);

  const BROWSER_PAGE_EDGE_TRANSITION_DISTANCE_PX = 32;
  const BROWSER_PAGE_EDGE_MASK_DEPTH = 0.8;

  const resolveBrowserPageEdgeStrength = (distance: number): number =>
    Math.min(
      1,
      Math.max(0, distance / BROWSER_PAGE_EDGE_TRANSITION_DISTANCE_PX),
    );

  const trackBrowserPageEdges = (
    panel: HTMLDivElement,
  ): { destroy: () => void } => {
    const stack = panel.parentElement;
    const updateEdgeEffects = (): void => {
      const maxScrollTop = Math.max(0, panel.scrollHeight - panel.clientHeight);
      const scrollTop = Math.min(maxScrollTop, Math.max(0, panel.scrollTop));

      for (const [edge, distance] of [
        ['top', scrollTop],
        ['bottom', maxScrollTop - scrollTop],
      ] as const) {
        const strength = resolveBrowserPageEdgeStrength(distance);
        stack?.style.setProperty(
          `--browser-page-${edge}-effect-strength`,
          String(strength),
        );
        stack?.style.setProperty(
          `--browser-page-${edge}-mask-opacity`,
          String(1 - strength * BROWSER_PAGE_EDGE_MASK_DEPTH),
        );
      }
    };

    const resizeObserver = new ResizeObserver(updateEdgeEffects);
    resizeObserver.observe(panel);
    if (panel.firstElementChild) {
      resizeObserver.observe(panel.firstElementChild);
    }
    panel.addEventListener('scroll', updateEdgeEffects, { passive: true });
    updateEdgeEffects();

    return {
      destroy: () => {
        resizeObserver.disconnect();
        panel.removeEventListener('scroll', updateEdgeEffects);
      },
    };
  };

  const settingsButtonHasUpdateIndicator = $derived(
    updateAvailable && activePage !== 'settings',
  );
  const settingsButtonLabel = $derived(
    updateAvailable
      ? i18n.t('browser.settingsUpdate')
      : i18n.t('browser.settings'),
  );
  const activeTreeAriaLabel = $derived(
    activePage === 'devices'
      ? i18n.t('browser.devicesAria')
      : activePage === 'groups'
        ? i18n.t('browser.groupsAria')
        : i18n.t('browser.racksAria'),
  );
  const emptyTreeMessage = $derived(
    activePage === 'groups'
      ? i18n.t('browser.emptyGroups')
      : activePage === 'racks'
        ? i18n.t('browser.emptyRacks')
        : null,
  );

  const resolveTreeNodeLabel = (node: VisibleBrowserTreeNode): string => {
    if (node.kind === 'device') {
      return i18n.t(getDeviceMessageKey(node.deviceKind));
    }

    if (node.kind === 'folder' && node.treeKind === 'device') {
      return i18n.t(getDeviceCategoryMessageKey(node.categoryId));
    }

    return node.label;
  };

  const presetTreeWithDraft = $derived.by(() =>
    insertPendingPresetFolder(presetTree, pendingPresetFolderDraft));
  const presetRootByType = $derived.by(() =>
    new Map(presetTreeWithDraft.map((root) => [root.presetType, root])));
  const devicePageTree = $derived.by(() =>
    mergeDevicePresetTree(
      deviceTree,
      presetRootByType.get('device') ?? null,
    ));
  const activeTreeRoots = $derived.by(() => {
    if (activePage === 'devices') {
      return devicePageTree;
    }

    const presetType = resolvePresetTypeForPage(activePage);
    return presetType ? presetRootByType.get(presetType)?.children ?? [] : [];
  });
  const expandedFolderIdSet = $derived.by(() => new Set(expandedFolderIds));
  const visibleRows = $derived.by(() =>
    collectVisibleRows(activeTreeRoots, expandedFolderIdSet));
  const visibleTreeNodeById = $derived.by(
    () => new Map(visibleRows.map((row) => [row.node.id, row.node])),
  );
  const visibleTreeRowById = $derived.by(
    () => new Map(visibleRows.map((row) => [row.node.id, row])),
  );
  const visibleRowIds = $derived(visibleRows.map((row) => row.node.id));
  const selectedRowIdSet = $derived.by(
    () => new Set(browserSelection.state.selectedRowIds),
  );
  const pendingPresetDraftKey = $derived(
    pendingPresetFolderDraft
      ? [
          pendingPresetFolderDraft.mode,
          pendingPresetFolderDraft.entryKind,
          pendingPresetFolderDraft.presetType,
          pendingPresetFolderDraft.relativePath.join('/'),
          pendingPresetFolderDraft.temporaryId ?? '',
        ].join(':')
      : null,
  );

  const isFolderExpanded = (folderId: string): boolean =>
    expandedFolderIdSet.has(folderId);

  const selectSingleRow = (rowId: string): void => {
    detachedKeyboardFocusRowId = null;
    browserSelection.selectSingle(rowId, visibleRowIds);
  };

  const focusRow = async (rowId: string): Promise<void> => {
    focusedRowId = rowId;
    await tick();
    treeItemRefs[rowId]?.focus();
  };

  const focusRowFromKeyboard = async (
    rowId: string,
    event: KeyboardEvent,
  ): Promise<void> => {
    if (event.shiftKey) {
      detachedKeyboardFocusRowId = null;
      browserSelection.selectRange(
        rowId,
        hasAdditiveSelectionModifier(event),
        visibleRowIds,
      );
    } else if (!hasAdditiveSelectionModifier(event)) {
      selectSingleRow(rowId);
    } else {
      detachedKeyboardFocusRowId = rowId;
    }

    await focusRow(rowId);
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

  const resolveTreeNodeIcon = (node: VisibleBrowserTreeNode): string => {
    if (node.kind === 'folder') {
      return node.treeKind === 'device'
        ? getDeviceBrowserCategoryIcon(node.categoryId)
        : node.icon ?? 'folder';
    }

    if (node.kind === 'device') {
      return getDeviceBrowserIcon(node.deviceKind);
    }

    if (node.loadStatus === 'error') {
      return 'error';
    }

    if (node.presetType === 'device' && node.deviceKind) {
      return getDeviceBrowserIcon(node.deviceKind);
    }

    if (node.presetType === 'group') {
      return 'combine_columns';
    }

    if (node.presetType === 'rack') {
      return 'view_week';
    }

    return 'tune';
  };

  const resolveTreeNodeAccentStyle = (
    node: VisibleBrowserTreeNode,
  ): string => {
    if (node.kind === 'folder' && node.treeKind === 'device') {
      return `--browser-icon-accent:var(${getDeviceBrowserCategoryAccentColorVar(node.categoryId)});`;
    }

    if (node.kind === 'device') {
      return `--browser-icon-accent:var(${getDeviceBrowserCategory(node.deviceKind).accentColorVar});`;
    }

    return '';
  };

  const handleLeafPointerDown = (
    node: BrowserTreeDeviceNode | BrowserTreePresetLeafNode,
    event: PointerEvent,
    dragSignal: AbortSignal | null,
  ): void => {
    const itemEl = event.currentTarget;
    if (!(itemEl instanceof HTMLElement)) {
      return;
    }

    if (node.kind === 'device') {
      const selectedDeviceKinds = browserSelection.includes(node.id)
        ? browserSelection
          .getOrderedSelectedRowIds(visibleRowIds)
          .map((rowId) => visibleTreeNodeById.get(rowId))
          .filter(
            (selectedNode): selectedNode is BrowserTreeDeviceNode =>
              selectedNode?.kind === 'device',
          )
          .map((selectedNode) => selectedNode.deviceKind)
        : [node.deviceKind];
      onBrowserPointerDown({
        source: selectedDeviceKinds.length > 1
          ? {
              kind: 'device-kinds',
              deviceKinds: selectedDeviceKinds,
            }
          : {
              kind: 'device-kind',
              deviceKind: selectedDeviceKinds[0] ?? node.deviceKind,
            },
        badgeLabel: selectedDeviceKinds.length > 1
          ? i18n.t('browser.selectedDevices', {
              count: selectedDeviceKinds.length,
            })
          : resolveTreeNodeLabel(node),
        sourceEvent: event,
        itemEl,
      });
      return;
    }

    if (!dragSignal) {
      return;
    }
    if (node.loadStatus === 'error') {
      return;
    }
    void onPresetFilePointerDown(node, event, itemEl, dragSignal);
  };

  const handleLeafDoubleClick = (
    node: BrowserTreeDeviceNode | BrowserTreePresetLeafNode,
  ): void => {
    if (node.kind === 'device') {
      onDeviceAdd(node.deviceKind);
      return;
    }

    if (node.loadStatus === 'error') {
      return;
    }

    void onPresetEntryOpen(node);
  };

  const resolvePresetContextMenuTarget = (
    node: VisibleBrowserTreeNode,
  ): PresetEntryContextTarget | null => {
    if (node.kind === 'folder' && 'isPending' in node && node.isPending) {
      return null;
    }

    if (node.kind === 'preset') {
      return {
        kind: 'preset-entry',
        presetType: node.presetType,
        source: node.source,
        relativePath: [...node.relativePath],
        entryKind: 'file',
        canShowInfo: node.loadStatus === 'loaded',
      };
    }

    if (
      (
        node.kind === 'device'
        || (node.kind === 'folder' && node.treeKind === 'device')
      )
      && node.presetDirectoryExists
    ) {
      return {
        kind: 'preset-entry',
        presetType: 'device',
        source: 'user',
        relativePath: [...node.presetRelativePath],
        entryKind: 'directory',
        isSystemFolder: true,
      };
    }

    if (node.kind === 'folder' && node.treeKind === 'preset') {
      return {
        kind: 'preset-entry',
        presetType: node.presetType,
        source: node.source,
        relativePath: [...node.relativePath],
        entryKind: 'directory',
        isSystemFolder: node.source === 'bundled',
      };
    }

    return null;
  };

  const resolveSelectedPresetContextMenuTarget = (
    clickedTarget: PresetEntryContextTarget,
  ): PresetBrowserContextTarget => {
    if (clickedTarget.isSystemFolder) {
      return clickedTarget;
    }

    const selectedTargets = browserSelection
      .getOrderedSelectedRowIds(visibleRowIds)
      .map((rowId) => visibleTreeNodeById.get(rowId))
      .filter((node): node is VisibleBrowserTreeNode => node !== undefined)
      .map((node) => resolvePresetContextMenuTarget(node))
      .filter(
        (target): target is PresetEntryContextTarget =>
          target !== null && !target.isSystemFolder,
      );

    if (selectedTargets.length <= 1) {
      return clickedTarget;
    }

    return {
      kind: 'preset-entries',
      entries: selectedTargets,
    };
  };

  const isMovablePresetEntry = (
    target: PresetEntryContextTarget | null,
  ): boolean =>
    target !== null
    && target.source === 'user'
    && !target.isSystemFolder
    && target.relativePath.length > 0;

  const isPresetDragEntry = (
    target: PresetEntryContextTarget | null,
  ): target is PresetEntryContextTarget =>
    isMovablePresetEntry(target)
    || (
      target !== null
      && target.source === 'bundled'
      && target.entryKind === 'file'
      && target.relativePath.length > 0
    );

  const resolvePresetMoveEntries = (
    node: VisibleBrowserTreeNode,
  ): {
    entries: PresetEntryContextTarget[];
    sourceRowIds: string[];
    badge: BrowserDragBadgeContent;
  } | null => {
    if (node.kind === 'preset' && node.loadStatus === 'error') {
      return null;
    }

    const clickedTarget = resolvePresetContextMenuTarget(node);
    if (!isPresetDragEntry(clickedTarget)) {
      return null;
    }

    const selectedRowIds = browserSelection.includes(node.id)
      ? browserSelection.getOrderedSelectedRowIds(visibleRowIds)
      : [node.id];
    const candidates: {
      rowId: string;
      node: VisibleBrowserTreeNode;
      target: PresetEntryContextTarget;
    }[] = [];
    for (const rowId of selectedRowIds) {
      const selectedNode = visibleTreeNodeById.get(rowId);
      const target = selectedNode
        ? resolvePresetContextMenuTarget(selectedNode)
        : null;
      if (
        isPresetDragEntry(target)
        && target.source === clickedTarget.source
        && target.presetType === clickedTarget.presetType
        && !(selectedNode.kind === 'preset' && selectedNode.loadStatus === 'error')
      ) {
        candidates.push({ rowId, node: selectedNode, target });
      }
    }
    const entries = normalizePresetEntrySelection(
      candidates.map((candidate) => candidate.target),
    );
    if (entries.length === 0) {
      return null;
    }
    const sourceNode = entries.length === 1
      ? candidates.find(({ target }) => target === entries[0])?.node ?? node
      : null;

    return {
      entries,
      sourceRowIds: candidates.map((candidate) => candidate.rowId),
      badge: {
        icon: sourceNode ? resolveTreeNodeIcon(sourceNode) : 'select_all',
        iconStyle: sourceNode ? resolveTreeNodeAccentStyle(sourceNode) : '',
        label: sourceNode
          ? resolveTreeNodeLabel(sourceNode)
          : i18n.t('browser.selectedItems', { count: entries.length }),
      },
    };
  };

  const resolvePresetMoveDestinationForNode = (
    node: VisibleBrowserTreeNode,
  ): BrowserPresetMoveDestination | null => {
    if (node.kind === 'folder' && 'isPending' in node && node.isPending) {
      return null;
    }
    if (
      node.kind === 'device'
      || (node.kind === 'folder' && node.treeKind === 'device')
    ) {
      return {
        presetType: 'device',
        source: 'user',
        relativePath: [...node.presetRelativePath],
        rowId: node.id,
      };
    }
    if (node.kind === 'folder' && node.treeKind === 'preset') {
      return {
        presetType: node.presetType,
        source: node.source,
        relativePath: [...node.relativePath],
        rowId: node.id,
      };
    }

    return null;
  };

  const isValidPresetMoveDestination = (
    destination: BrowserPresetMoveDestination,
    entries: readonly PresetEntryContextTarget[],
  ): boolean =>
    entries.every((entry) => entry.source === 'user')
    && canMovePresetEntriesTo(
      entries,
      destination,
      presetOccupiedPaths,
    );

  const resolvePresetMoveRootDestination = (
    presetType: PresetFileKind | null,
  ): BrowserPresetMoveDestination | null =>
    presetType
      ? {
          presetType,
          source: 'user',
          relativePath: [],
          rowId: null,
        }
      : null;

  const resolvePresetMoveDestinationAtPoint = (
    clientX: number,
    clientY: number,
    entries: readonly PresetEntryContextTarget[],
  ): BrowserPresetMoveDestination | null => {
    const element = document.elementFromPoint(clientX, clientY);
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    const rowElement = element.closest<HTMLElement>('[data-browser-row-id]');
    if (rowElement) {
      const rowId = rowElement.dataset.browserRowId;
      const row = rowId ? visibleTreeRowById.get(rowId) : null;
      if (
        row
        && (
          row.node.kind === 'preset'
          || (row.node.kind === 'folder' && row.node.treeKind === 'preset')
        )
        && row.node.source === 'bundled'
      ) {
        return null;
      }
      const directDestination = row
        ? resolvePresetMoveDestinationForNode(row.node)
        : null;
      if (directDestination) {
        return isValidPresetMoveDestination(directDestination, entries)
          ? directDestination
          : null;
      }

      const parentNode = row?.parentId
        ? visibleTreeNodeById.get(row.parentId)
        : null;
      const destination = parentNode
        ? resolvePresetMoveDestinationForNode(parentNode)
        : resolvePresetMoveRootDestination(
            resolvePresetTypeForPage(activePage),
          );
      return destination
        && isValidPresetMoveDestination(destination, entries)
        ? destination
        : null;
    }

    const presetRoot = element.closest<HTMLElement>('[data-preset-root-type]');
    const rootType = presetRoot?.dataset.presetRootType;
    const isActiveTreeArea =
      element.closest('.browser-tree-root') !== null
      || element.closest('.browser-page-panel') === browserPagePanelEl;
    const presetType = isPresetFileKind(rootType)
      ? rootType
      : isActiveTreeArea
        ? resolvePresetTypeForPage(activePage)
        : null;
    const destination = resolvePresetMoveRootDestination(presetType);
    return destination && isValidPresetMoveDestination(destination, entries)
      ? destination
      : null;
  };

  const presetMoveDrag = new BrowserPresetMoveDrag({
    resolveDestination: resolvePresetMoveDestinationAtPoint,
    getDragBadge: () => document.getElementById('browser-drag-badge'),
    getScrollContainer: () => browserPagePanelEl,
    expandDestination: (rowId) => {
      if (!expandedFolderIdSet.has(rowId)) {
        expandedFolderIds = [...expandedFolderIds, rowId];
      }
    },
    onMove: (entries, destination) =>
      onPresetEntriesMove(entries, destination),
  });

  const handleTreeItemContextMenu = (
    node: VisibleBrowserTreeNode,
    event: MouseEvent,
  ): void => {
    const clickedTarget = resolvePresetContextMenuTarget(node);
    if (!clickedTarget) {
      return;
    }

    if (clickedTarget.source === 'bundled' && clickedTarget.entryKind !== 'file') {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    detachedKeyboardFocusRowId = null;
    if (!browserSelection.includes(node.id) || clickedTarget.source === 'bundled') {
      selectSingleRow(node.id);
    }
    focusedRowId = node.id;
    const selectionTarget = resolveSelectedPresetContextMenuTarget(clickedTarget);
    onOpenContextMenu(
      event.clientX,
      event.clientY,
      selectionTarget,
    );
  };

  const handlePresetPageContextMenu = (
    presetType: PresetFileKind,
    event: MouseEvent,
  ): void => {
    event.preventDefault();
    onOpenContextMenu(event.clientX, event.clientY, {
      kind: 'preset-entry',
      presetType,
      source: 'user',
      relativePath: [],
      entryKind: 'directory',
    });
  };

  const handleTreeItemClick = (
    row: VisibleTreeRow,
    event: MouseEvent,
  ): void => {
    if (presetMoveDrag.consumeSuppressedClick()) {
      event.preventDefault();
      return;
    }

    focusedRowId = row.node.id;
    if (event.shiftKey) {
      browserSelection.selectRange(
        row.node.id,
        hasAdditiveSelectionModifier(event),
        visibleRowIds,
      );
      return;
    }

    if (hasAdditiveSelectionModifier(event)) {
      browserSelection.toggle(row.node.id, visibleRowIds);
      return;
    }

    selectSingleRow(row.node.id);
  };

  const handleTreeItemPointerDown = (
    row: VisibleTreeRow,
    event: PointerEvent,
  ): void => {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }

    detachedKeyboardFocusRowId = null;
    const itemEl = event.currentTarget;
    if (itemEl instanceof HTMLElement) {
      itemEl.focus({ preventScroll: true });
    }
    focusedRowId = row.node.id;
    if (
      !event.shiftKey
      && !hasAdditiveSelectionModifier(event)
      && !browserSelection.includes(row.node.id)
    ) {
      selectSingleRow(row.node.id);
    }

    const move = !event.shiftKey && !hasAdditiveSelectionModifier(event)
      ? resolvePresetMoveEntries(row.node)
      : null;
    const dragSignal = move
      ? presetMoveDrag.begin(
          move.entries,
          move.sourceRowIds,
          move.badge,
          event,
        )
      : null;

    if (row.node.kind !== 'folder') {
      handleLeafPointerDown(row.node, event, dragSignal);
    }
  };

  const handleTreeItemKeyDown = async (
    row: VisibleTreeRow,
    event: KeyboardEvent,
  ): Promise<void> => {
    const rowIndex = resolveRowIndex(row.node.id);
    if (rowIndex < 0) {
      return;
    }

    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      if (event.repeat) {
        return;
      }

      if (event.shiftKey) {
        detachedKeyboardFocusRowId = null;
        browserSelection.selectRange(
          row.node.id,
          hasAdditiveSelectionModifier(event),
          visibleRowIds,
        );
      } else {
        browserSelection.toggle(row.node.id, visibleRowIds);
        detachedKeyboardFocusRowId = browserSelection.includes(row.node.id)
          ? null
          : row.node.id;
      }
      focusedRowId = row.node.id;
      return;
    }

    if (event.key === 'ArrowDown') {
      const nextRow = visibleRows[rowIndex + 1];
      if (nextRow) {
        event.preventDefault();
        await focusRowFromKeyboard(nextRow.node.id, event);
      }
      return;
    }

    if (event.key === 'ArrowUp') {
      const prevRow = visibleRows[rowIndex - 1];
      if (prevRow) {
        event.preventDefault();
        await focusRowFromKeyboard(prevRow.node.id, event);
      }
      return;
    }

    if (event.key === 'ArrowRight') {
      if (!canExpandTreeNode(row.node)) {
        return;
      }

      event.preventDefault();
      if (!isFolderExpanded(row.node.id)) {
        toggleFolder(row.node.id);
        return;
      }

      const nextRow = visibleRows[rowIndex + 1];
      if (nextRow && nextRow.parentId === row.node.id) {
        await focusRowFromKeyboard(nextRow.node.id, event);
      }
      return;
    }

    if (event.key === 'ArrowLeft') {
      if (canExpandTreeNode(row.node) && isFolderExpanded(row.node.id)) {
        event.preventDefault();
        toggleFolder(row.node.id);
        return;
      }

      if (row.parentId) {
        event.preventDefault();
        await focusRowFromKeyboard(row.parentId, event);
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

  const matchesPresetEntrySelection = (
    row: VisibleTreeRow,
    entry: PresetEntrySelectionTarget['entries'][number],
  ): boolean => {
    const target = resolvePresetContextMenuTarget(row.node);
    return target?.entryKind === entry.entryKind
      && target.presetType === entry.presetType
      && areEqualRelativePaths(target.relativePath, entry.relativePath);
  };

  $effect(() => {
    const nextRootIds = deviceTree
      .map((node: BrowserTreeDeviceFolderNode) => node.id)
      .filter((id: string) => !initializedRootFolderIds.includes(id));
    if (nextRootIds.length === 0) {
      return;
    }

    initializedRootFolderIds = [...initializedRootFolderIds, ...nextRootIds];
    expandedFolderIds = [...expandedFolderIds, ...nextRootIds];
  });

  $effect(() => {
    const firstVisibleRowId = visibleRows[0]?.node.id ?? null;
    if (!firstVisibleRowId) {
      browserSelection.clear();
      focusedRowId = null;
      detachedKeyboardFocusRowId = null;
      return;
    }

    browserSelection.reconcile(visibleRowIds);
    if (
      detachedKeyboardFocusRowId !== null
      && !visibleRowIds.includes(detachedKeyboardFocusRowId)
    ) {
      detachedKeyboardFocusRowId = null;
    }
    const focusedRowIsVisible =
      focusedRowId !== null && visibleRowIds.includes(focusedRowId);
    if (!focusedRowIsVisible) {
      focusedRowId = browserSelection.state.selectedRowIds.find(
        (rowId) => visibleRowIds.includes(rowId),
      ) ?? firstVisibleRowId;
    }
  });

  $effect(() => {
    const draft = pendingPresetFolderDraft;
    if (!draft) {
      focusedPresetDraftKey = null;
      return;
    }

    const ancestorRelativePath = draft.mode === 'create'
      ? draft.relativePath
      : draft.relativePath.slice(0, -1);
    const ancestorIds = ancestorRelativePath.map(
      (_segment: string, index: number) =>
        resolvePresetDirectoryNodeId(
          draft.presetType,
          ancestorRelativePath.slice(0, index + 1),
        ),
    );
    const nextExpandedFolderIds = Array.from(new Set([...expandedFolderIds, ...ancestorIds]));
    const didExpandFolders = nextExpandedFolderIds.length !== expandedFolderIds.length;
    if (didExpandFolders) {
      expandedFolderIds = nextExpandedFolderIds;
    }

    const targetRowId = draft.mode === 'create'
      ? draft.temporaryId ?? ''
      : resolvePresetNodeId(draft.presetType, draft.relativePath);
    const didSelectPendingRow =
      browserSelection.state.selectedRowIds.length !== 1
      || !browserSelection.includes(targetRowId);
    if (didSelectPendingRow) {
      selectSingleRow(targetRowId);
    }
    focusedRowId = targetRowId;

    if (focusedPresetDraftKey !== pendingPresetDraftKey) {
      focusedPresetDraftKey = pendingPresetDraftKey;
      void tick().then(() => {
        pendingPresetFolderInputEl?.focus();
        pendingPresetFolderInputEl?.select();
      });
    }
  });

  $effect(() => {
    const selectionTarget = presetEntrySelectionTarget;
    if (
      !selectionTarget
      || selectionTarget.entries.length === 0
      || activePage
        !== resolveBrowserPageForPresetType(selectionTarget.entries[0].presetType)
    ) {
      return;
    }

    const matches = selectionTarget.entries
      .map((entry: PresetEntrySelectionTarget['entries'][number]) =>
        visibleRows.find((row: VisibleTreeRow) =>
          matchesPresetEntrySelection(row, entry)))
      .filter(
        (row: VisibleTreeRow | undefined): row is VisibleTreeRow => row !== undefined,
      );
    if (matches.length === 0) {
      return;
    }

    const matchIds = matches.map((row: VisibleTreeRow) => row.node.id);
    browserSelection.replace(matchIds, visibleRowIds);
    detachedKeyboardFocusRowId = null;
    void focusRow(matchIds[matchIds.length - 1]).then(() => {
      onPresetEntrySelectionHandled(selectionTarget.token);
    });
  });

  onMount(() => presetMoveDrag.mount());
</script>

<aside class="browser-panel" class:has-titlebar-spacer={reserveTitlebarSpace}>
  <div
    class="browser-page-top-boundary"
    class:is-window-drag-region={reserveTitlebarSpace}
    aria-hidden="true"
  ></div>
  <div class="browser-view">
    <div class="browser-page-switch">
      <div class="browser-page-switch-group">
        <Button
          class="browser-page-switch-button"
          data-preset-root-type="device"
          variant="icon"
          label={i18n.t('browser.devices')}
          icon="widgets"
          pressed={activePage === 'devices'}
          onClick={() => onPageSelect('devices')}
          oncontextmenu={(event: MouseEvent) =>
            handlePresetPageContextMenu('device', event)}
        />
        <Button
          class="browser-page-switch-button"
          data-preset-root-type="group"
          variant="icon"
          label={i18n.t('browser.groups')}
          icon="combine_columns"
          pressed={activePage === 'groups'}
          onClick={() => onPageSelect('groups')}
          oncontextmenu={(event: MouseEvent) =>
            handlePresetPageContextMenu('group', event)}
        />
        <Button
          class="browser-page-switch-button"
          data-preset-root-type="rack"
          variant="icon"
          label={i18n.t('browser.racks')}
          icon="view_column"
          pressed={activePage === 'racks'}
          onClick={() => onPageSelect('racks')}
          oncontextmenu={(event: MouseEvent) =>
            handlePresetPageContextMenu('rack', event)}
        />
      </div>
      <div class="browser-page-switch-group">
        {#if canToggleWindowLayer}
          <Button
            class="browser-page-switch-button"
            variant="icon"
            label={mainWindowAlwaysOnTop
              ? i18n.t('browser.unpinWindow')
              : i18n.t('browser.pinWindow')}
            icon="push_pin"
            pressed={mainWindowAlwaysOnTop}
            onClick={onMainWindowAlwaysOnTopToggle}
          />
        {/if}
        <Button
          class={`browser-page-switch-button${settingsButtonHasUpdateIndicator ? ' has-update-indicator' : ''}`}
          variant="icon"
          label={settingsButtonLabel}
          icon="settings"
          pressed={activePage === 'settings'}
          onClick={() => onPageSelect('settings')}
        />
      </div>
    </div>

    <div class="browser-page-stack">
      <div
        use:trackBrowserPageEdges
        bind:this={browserPagePanelEl}
        class="browser-page-panel"
        class:is-preset-move-root-target={
          presetMoveDrag.destination !== null
          && presetMoveDrag.destination.relativePath.length === 0
        }
      >
        <div>
      {#if activePage === 'settings'}
        <SidebarSettingsPage
          {launchpadMk2Enabled}
          {locale}
          {reduceAnimation}
          {themePreset}
          {themeHue}
          {themeSaturation}
          {paletteDescription}
          {appVersionText}
          {updateCheckText}
          {updateAvailable}
          {aboutDescription}
          {aboutDescriptionTone}
          {githubDescription}
          onLaunchpadModelToggle={onLaunchpadModelToggle}
          onLocaleChange={onLocaleChange}
          onReduceAnimationToggle={onReduceAnimationToggle}
          onThemePresetChange={onThemePresetChange}
          onThemeHueChange={onThemeHueChange}
          onThemeSaturationChange={onThemeSaturationChange}
          onPaletteReset={onPaletteReset}
          onPaletteFileChange={onPaletteFileChange}
          onOpenAboutSite={onOpenAboutSite}
          onOpenGitHub={onOpenGitHub}
          onOpenLatestReleasePage={onOpenLatestReleasePage}
        />
      {:else}
        {#if presetErrorText}
          <p class="browser-status browser-status-error">{presetErrorText}</p>
        {/if}
        {#if !presetErrorText && visibleRows.length === 0 && emptyTreeMessage}
          <p class="browser-status browser-empty-state">{emptyTreeMessage}</p>
        {/if}
        <ul
          class="browser-tree-list browser-tree-root"
          role="tree"
          aria-multiselectable="true"
          aria-label={activeTreeAriaLabel}
        >
          {#each visibleRows as row, rowIndex (row.node.id)}
            {@const isSelected = selectedRowIdSet.has(row.node.id)}
            <li
              role="none"
              class:is-selected={isSelected}
              class:has-selected-previous={isSelected
                && rowIndex > 0
                && selectedRowIdSet.has(visibleRows[rowIndex - 1].node.id)}
              class:has-selected-next={isSelected
                && rowIndex < visibleRows.length - 1
                && selectedRowIdSet.has(visibleRows[rowIndex + 1].node.id)}
            >
              <div
                use:registerTreeItem={row.node.id}
                use:hint={resolvePresetPreviewHint(
                  row.node,
                  paletteRevision,
                  resolvePaletteRgb,
                )}
                data-browser-row-id={row.node.id}
                class="browser-tree-item"
                class:is-preset-move-source={
                  presetMoveDrag.active?.didMove === true
                  && presetMoveDrag.active.sourceRowIds.includes(row.node.id)
                }
                class:is-preset-move-drop-target={
                  presetMoveDrag.destination?.rowId === row.node.id
                }
                class:has-detached-keyboard-focus={
                  detachedKeyboardFocusRowId === row.node.id
                }
                class:has-preset-load-error={
                  row.node.kind === 'preset' && row.node.loadStatus === 'error'
                }
                style={`--browser-tree-level:${row.level};`}
                role="treeitem"
                aria-level={row.level}
                aria-posinset={row.posInSet}
                aria-setsize={row.setSize}
                aria-selected={isSelected}
                aria-label={row.node.kind === 'preset' && row.node.loadStatus === 'error'
                  ? `${resolveTreeNodeLabel(row.node)}: ${resolvePresetFileErrorMessage(row.node.loadErrorCode)}`
                  : undefined}
                aria-expanded={canExpandTreeNode(row.node)
                  ? isFolderExpanded(row.node.id)
                  : undefined}
                tabindex={focusedRowId === row.node.id ? 0 : -1}
                ondragstart={handleDragStart}
                onclick={(event) => handleTreeItemClick(row, event)}
                ondblclick={() => {
                  if (row.node.kind === 'folder') {
                    toggleFolder(row.node.id);
                    return;
                  }

                  handleLeafDoubleClick(row.node);
                }}
                onkeydown={(event) => void handleTreeItemKeyDown(row, event)}
                onfocus={() => {
                  focusedRowId = row.node.id;
                }}
                onpointerdown={(event) => handleTreeItemPointerDown(row, event)}
                oncontextmenu={(event) => handleTreeItemContextMenu(row.node, event)}
              >
                {#if canExpandTreeNode(row.node)}
                  {@const folderToggleLabel = isFolderExpanded(row.node.id)
                    ? i18n.t('browser.collapseFolder')
                    : i18n.t('browser.expandFolder')}
                  <button
                    class="browser-tree-leading-slot browser-tree-disclosure-slot browser-tree-chevron"
                    type="button"
                    aria-label={folderToggleLabel}
                    tabindex="-1"
                    onpointerdown={(event) => event.stopPropagation()}
                    onclick={(event) => {
                      event.stopPropagation();
                      if (!browserSelection.includes(row.node.id)) {
                        selectSingleRow(row.node.id);
                      }
                      focusedRowId = row.node.id;
                      toggleFolder(row.node.id);
                    }}
                    ondblclick={(event) => event.stopPropagation()}
                  >
                    <span class="material-symbols-rounded" aria-hidden="true">
                      {isFolderExpanded(row.node.id) ? 'expand_more' : 'chevron_right'}
                    </span>
                  </button>
                {:else}
                  <span
                    class="browser-tree-leading-slot browser-tree-disclosure-slot"
                    aria-hidden="true"
                  ></span>
                {/if}
                <span
                  class="browser-tree-leading-slot browser-tree-item-icon browser-entry-icon material-symbols-rounded"
                  style={resolveTreeNodeAccentStyle(row.node)}
                  aria-hidden="true"
                >
                  {resolveTreeNodeIcon(row.node)}
                </span>
                {#if isEditingPresetFolderRow(row.node, pendingPresetFolderDraft)}
                  <input
                    bind:this={pendingPresetFolderInputEl}
                    class="browser-tree-item-input"
                    type="text"
                    value={pendingPresetFolderDraft?.draftName ?? ''}
                    aria-label={pendingPresetFolderDraft?.entryKind === 'file'
                      ? i18n.t('browser.presetFileName')
                      : i18n.t('browser.presetFolderName')}
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
                  <span class="browser-tree-item-label">{resolveTreeNodeLabel(row.node)}</span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
        </div>
      </div>
    </div>
  </div>
</aside>

<style lang="scss">
  .browser-panel {
    --browser-page-top-inset: var(--gap-10);
    --browser-page-bottom-extension: var(--gap-10);
    --browser-page-fade-size: var(--gap-16);
    --browser-page-blur-offset: var(--gap-4);

    position: relative;
    display: flex;
    flex-direction: column;
    flex: 0 0 var(--browser-panel-width, var(--sidebar-width));
    min-width: 0;
    min-height: 0;
    padding: var(--gap-10);
    background: var(--color-surface);
    border-right: 1px solid var(--color-border-tertiary);

    &.has-titlebar-spacer {
      --floating-layer-viewport-top: 48px;
      --browser-page-top-inset: calc(
        var(--gap-10) + var(--gap-32) - var(--gap-4)
      );
    }

  }

  .browser-page-top-boundary {
    position: absolute;
    left: 0;
    width: 100%;
    z-index: 2;
    -webkit-app-region: no-drag;
    top: 0;
    height: var(--browser-page-top-inset);

    &.is-window-drag-region {
      -webkit-app-region: drag;
    }
  }

  .browser-view {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    margin-top: calc(var(--gap-32) - var(--gap-4));
    display: flex;
    gap: var(--gap-10);
  }

  .browser-panel:not(.has-titlebar-spacer) {
    .browser-view {
      margin-top: 0;
    }
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
  }

  :global(.button.browser-page-switch-button) {
    position: relative;
  }

  :global(.button.browser-page-switch-button.has-update-indicator)::after {
    content: '';
    position: absolute;
    right: 0.1875rem;
    top: 0.1875rem;
    width: 0.35rem;
    height: 0.35rem;
    border-radius: var(--radius-round);
    background: var(--color-surface-inverse);
  }

  .browser-page-stack {
    --browser-page-top-effect-strength: 0;
    --browser-page-bottom-effect-strength: 0;
    --browser-page-top-mask-opacity: 1;
    --browser-page-bottom-mask-opacity: 1;

    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    margin-top: calc(0px - var(--browser-page-top-inset));
    margin-bottom: calc(0px - var(--browser-page-bottom-extension));

    &::before,
    &::after {
      content: '';
      position: absolute;
      left: calc(0px - var(--gap-4));
      right: calc(0px - var(--gap-4));
      z-index: 1;
      pointer-events: none;
      backdrop-filter: blur(var(--gap-4));
    }

    &::before {
      top: 0;
      height: calc(
        var(--browser-page-top-inset)
        + var(--browser-page-fade-size)
        - var(--browser-page-blur-offset)
      );
      mask-image: linear-gradient(
        to bottom,
        black 0 calc(
          var(--browser-page-top-inset) - var(--browser-page-blur-offset)
        ),
        transparent
      );
      opacity: var(--browser-page-top-effect-strength);
    }

    &::after {
      bottom: 0;
      height: calc(
        var(--browser-page-fade-size) - var(--browser-page-blur-offset)
      );
      mask-image: linear-gradient(
        to top,
        black,
        transparent
      );
      opacity: var(--browser-page-bottom-effect-strength);
    }
  }

  .browser-page-panel {
    position: absolute;
    inset: 0;
    padding-top: var(--browser-page-top-inset);
    padding-bottom: var(--browser-page-bottom-extension);
    overflow-y: auto;
    overflow-x: hidden;
    mask-image: linear-gradient(
      to bottom,
      rgb(0 0 0 / var(--browser-page-top-mask-opacity))
        0 var(--browser-page-top-inset),
      black calc(
        var(--browser-page-top-inset) + var(--browser-page-fade-size)
      ),
      black calc(100% - var(--browser-page-fade-size)),
      rgb(0 0 0 / var(--browser-page-bottom-mask-opacity))
    );

    &.is-preset-move-root-target {
      background: var(--color-surface-interactive);
      border-radius: var(--radius-4);
    }
  }

  .browser-tree-list {
    margin: 0;
    padding: 0;
    list-style: none;

    li:not(.is-selected):hover {
      border-radius: var(--radius-4);
      background: var(--color-surface-interactive);
    }

    li.is-selected {
      background: var(--color-surface-active);
      border-radius: var(--radius-4);

      &.has-selected-previous {
        border-top-left-radius: 0;
        border-top-right-radius: 0;
      }

      &.has-selected-next {
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
      }
    }
  }

  .browser-tree-leading-slot {
    height: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .browser-tree-chevron {
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--color-text-secondary);

    .material-symbols-rounded {
      font-size: var(--text-16);
      line-height: 1;
      font-variation-settings: 'FILL' 1, 'wght' 400;
    }
  }

  .browser-tree-disclosure-slot {
    width: 0.75rem;
    flex: 0 0 0.75rem;
  }

  .browser-tree-item {
    min-width: 0;
    padding: {
      block: 0;
      left: calc(
        var(--gap-2)
        + (var(--browser-tree-level, 1) - 1) * var(--gap-8)
      );
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

    &.has-detached-keyboard-focus:focus {
      outline: 2px solid var(--color-focus-ring);
      outline-offset: -2px;
    }

    &:global(.is-dragging) {
      opacity: 0.7;
    }

    &.is-preset-move-source {
      opacity: 0.55;
    }

    &.is-preset-move-drop-target {
      background: var(--color-surface-active);
    }

    &.has-preset-load-error {
      color: var(--color-text-secondary);

      .browser-entry-icon {
        color: var(--color-text-tertiary);
      }
    }

    &-icon {
      width: 1.25rem;
      flex: 0 0 1.25rem;
      margin-right: var(--gap-2);
    }

    &-label {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &-input {
      flex: 1 1 0;
      min-width: 0;
      width: 0;
      height: 1.5rem;
      padding: 0;
      font: inherit;
    }
  }

  .browser-status {
    font-size: var(--text-12);
    color: var(--color-text-secondary);

    &-error {
      color: var(--color-text-primary);
    }
  }

  .browser-empty-state {
    position: absolute;
    inset: 0;
    padding: var(--gap-12);
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    pointer-events: none;
  }

  :global(html.is-browser-preset-moving),
  :global(html.is-browser-preset-moving *) {
    cursor: grabbing !important;
    user-select: none;
  }

</style>
