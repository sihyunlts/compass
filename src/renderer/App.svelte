<script lang="ts">
  /**
   * Main renderer composition root.
   * Delegates non-visual orchestration to renderer/app modules and keeps UI wiring here.
   */
  import { onMount, tick } from 'svelte';

  import {
    getRendererDeviceLabel,
    RENDERER_DEVICE_GROUPS,
    type RendererDeviceKind,
  } from '../devices';
  import type { PaletteFilePayload } from '../shared/model';
  import { parsePresetFileText } from '../shared/presets';
  import type {
    PresetBrowserTreeNode,
  } from '../shared/contracts/ipc/presets';
  import { AUTO_CREATE_LENGTH_OPTIONS } from '../shared/beat-length';
  import { sanitizeSidebarWidth } from './features/editor/persistence-storage';
  import BrowserPanel from './components/BrowserPanel.svelte';
  import type {
    BrowserTreeDeviceLeafNode,
    BrowserTreeDeviceFolderNode,
    BrowserTreePresetFolderNode,
    BrowserTreePresetLeafNode,
  } from './components/browser-tree-types';
  import type { ContextMenuTarget } from './components/context-menu-types';
  import Button from './components/Button.svelte';
  import SidebarResizer from './components/SidebarResizer.svelte';
  import DeviceRack from './components/DeviceRack.svelte';
  import type {
    BrowserInsertSource,
    RackPresetFileDrop,
    RackScrollMetrics,
  } from './components/device-rack-types';
  import RackHeaderScrollbar from './components/RackHeaderScrollbar.svelte';
  import PreviewPanel from './components/PreviewPanel.svelte';
  import ContextMenu from './components/ContextMenu.svelte';
  import ModalDialog from './components/ModalDialog.svelte';
  import { createPaletteController } from './app/palette-controller';
  import { mountBridgeSubscriptions } from './app/bridge-subscriptions';
  import { createHeaderIndicator } from './app/header-indicator.svelte';
  import { mountKeyboardShortcuts } from './app/keyboard-shortcuts';
  import { createPlaybackSession } from './app/playback-session.svelte';
  import { createSendFlow } from './app/send-flow';
  import {
    createEditorSession,
    type EditorRackBinding,
  } from './features/editor/session.svelte';
  import {
    buildDevicePresetFile,
    buildGroupPresetFile,
    buildRackPresetFile,
    resolveDevicePresetSuggestedName,
    resolveGroupPresetSuggestedName,
  } from './features/editor/presets';
  import {
    selectClipboardAvailable,
    selectHistoryControls,
    selectPreviewBpmText,
  } from './features/editor/selectors';
  import { resolveGroupMemberIds } from './features/editor/chain-ops';
  import { createPreviewSession } from './features/preview/session.svelte';
  import type { RackDropZone } from './features/rack/drop-ops';
  import type { RackViewApi } from './features/rack/api';

  const AUTO_PREVIEW_DEBOUNCE_MS = 120;
  const HISTORY_MAX_ENTRIES = 100;
  const DEFAULT_LED_RGB = '255 166 57';
  const INTERACTIVE_ELEMENT_SELECTOR = 'button, input, select, textarea, option';
  const DEFAULT_PRESET_DROP_ZONE: RackDropZone = {
    kind: 'outside',
    targetId: null,
    placement: 'after',
  };
  const PRESET_ROOT_LABELS = {
    device: 'Devices',
    group: 'Groups',
    rack: 'Racks',
  } as const;
  type PendingRackPresetLoadTarget =
    | {
      kind: 'browser-entry';
      entry: BrowserTreePresetLeafNode;
    }
    | {
      kind: 'file-picker';
    };

  const toDeviceLeafNode = (
    kind: RendererDeviceKind,
  ): BrowserTreeDeviceLeafNode => ({
    kind: 'device',
    id: `device:${kind}`,
    label: getRendererDeviceLabel(kind),
    deviceKind: kind,
  });

  const DEVICE_BROWSER_TREE: BrowserTreeDeviceFolderNode[] = [
    {
      kind: 'folder',
      treeKind: 'device',
      id: 'device-group:generators',
      label: 'Generators',
      children: RENDERER_DEVICE_GROUPS.generator.map((kind) => toDeviceLeafNode(kind)),
    },
    {
      kind: 'folder',
      treeKind: 'device',
      id: 'device-group:effects',
      label: 'Effects',
      children: RENDERER_DEVICE_GROUPS.effect.map((kind) => toDeviceLeafNode(kind)),
    },
  ];

  const bridgeClient = window.compass;
  let appVersionText = $state('');
  let rackViewApi: RackViewApi | null = $state(null);
  let contextMenuComponent: ReturnType<typeof ContextMenu> | null = $state(null);
  let pendingPresetDeleteTarget = $state<Extract<ContextMenuTarget, { kind: 'preset-entry' }> | null>(null);
  let isPresetDeletePending = $state(false);
  let pendingRackPresetLoadTarget = $state<PendingRackPresetLoadTarget | null>(null);
  let isRackPresetLoadPending = $state(false);

  const closeContextMenu = (): void => {
    contextMenuComponent?.close();
  };

  const syncRackAfterRender = async (): Promise<void> => {
    await tick();
    rackViewApi?.syncAfterRender();
    closeContextMenu();
  };

  const editorSession = createEditorSession({
    autoPreviewDebounceMs: AUTO_PREVIEW_DEBOUNCE_MS,
    historyMaxEntries: HISTORY_MAX_ENTRIES,
    onAutoPreview: () => playbackSession.runPreview(),
    onSyncAfterRender: () => syncRackAfterRender(),
  });
  const previewSession = createPreviewSession();
  const uiState = editorSession.state;
  const previewState = previewSession.state;
  const historyControls = $derived.by(() => selectHistoryControls(uiState));
  const bpmText = $derived.by(() => selectPreviewBpmText(uiState.previewBpm));
  const clipboardAvailable = $derived.by(() => selectClipboardAvailable(uiState));

  let paletteRevision = $state(0);
  const paletteController = createPaletteController({
    onPaletteNameChanged: (nameText) => {
      editorSession.commands.setPaletteNameText(nameText);
      paletteRevision += 1;
    },
  });
  const resolvePaletteRgb = (velocity: number): string =>
    paletteController.getLedRgb(velocity, '0 0 0');
  const headerIndicator = createHeaderIndicator({
    getText: () => uiState.headerIndicatorText,
    setText: (text) => {
      editorSession.commands.setHeaderIndicatorText(text);
    },
    clearText: () => {
      editorSession.commands.clearHeaderIndicatorText();
    },
  });
  const playbackSession = createPlaybackSession({
    bridgeClient,
    editorSession,
    previewSession,
    headerIndicator,
    resolveLedRgb: (velocity) => paletteController.getLedRgb(velocity, DEFAULT_LED_RGB),
  });
  const sendFlow = createSendFlow({
    bridgeClient,
    editorSession,
    headerIndicator,
    playbackSession,
  });

  let rackScrollMetrics: RackScrollMetrics = $state({
    scrollLeft: 0,
    scrollWidth: 1,
    clientWidth: 1,
  });
  let rackMiniMapContentRevision = $state(0);
  let presetTree = $state<BrowserTreePresetFolderNode[]>([]);
  let isPresetLoading = $state(false);
  let presetErrorText = $state<string | null>(null);
  let presetListRequestToken = 0;

  const createRackBinding = (): EditorRackBinding | null => {
    if (!rackViewApi) {
      return null;
    }

    return {
      getSelectedGroupContexts: () => rackViewApi?.getSelectedGroupContexts() ?? [],
      getOrderedSelectedDeviceIds: () => rackViewApi?.getOrderedSelectedDeviceIds() ?? [],
      selectAllDevices: (ids) => {
        rackViewApi?.selectAllDevices(ids);
      },
      setSelectedDeviceIds: (ids, orderedDeviceIds) => {
        rackViewApi?.setSelectedDeviceIds(ids, orderedDeviceIds);
      },
      setSelectedGroupIds: (ids, orderedGroupIds) => {
        rackViewApi?.setSelectedGroupIds(ids, orderedGroupIds);
      },
      applyNextSelectionAfterDelete: (deviceIds) => {
        rackViewApi?.applyNextSelectionAfterDelete(deviceIds);
      },
      clearSelection: () => {
        rackViewApi?.clearSelection();
      },
      syncAfterRender: () => {
        rackViewApi?.syncAfterRender();
      },
      startRenamingDevice: (deviceId) =>
        rackViewApi?.startRenamingDevice(deviceId) ?? false,
      startRenamingGroup: (groupId) =>
        rackViewApi?.startRenamingGroup(groupId) ?? false,
      handleBrowserPointerDown: (event, source, itemEl, badgeLabel) => {
        rackViewApi?.handleBrowserPointerDown(event, source, itemEl, badgeLabel);
      },
    };
  };

  $effect(() => {
    editorSession.commands.attachRackBinding(createRackBinding());
  });

  $effect(() => {
    void uiState.headerIndicatorText;
    headerIndicator.syncFromSource();
  });

  $effect(() => {
    if (uiState.sidebarPage !== 'presets') {
      return;
    }

    void loadPresetTree();
  });

  const handleUndoClick = (): void => {
    closeContextMenu();
    editorSession.commands.undo();
  };

  const handleRedoClick = (): void => {
    closeContextMenu();
    editorSession.commands.redo();
  };

  const handleRackScrollMetricsChange = (metrics: RackScrollMetrics): void => {
    rackScrollMetrics = metrics;
  };

  const handleRackMiniMapContentRevisionChange = (revision: number): void => {
    rackMiniMapContentRevision = revision;
  };

  const handleRackHeaderScrollRequest = (nextScrollLeft: number): void => {
    rackViewApi?.setScrollLeft(nextScrollLeft);
  };

  function mapPresetTreeNode(
    node: PresetBrowserTreeNode,
  ): BrowserTreePresetFolderNode | BrowserTreePresetLeafNode {
    if (node.kind === 'folder') {
      return {
        kind: 'folder',
        treeKind: 'preset',
        id: node.id,
        label: node.label,
        presetType: node.presetType,
        relativePath: [...node.relativePath],
        children: node.children.map((child) => mapPresetTreeNode(child)),
      };
    }

    return {
      kind: 'preset',
      id: node.id,
      label: node.label,
      presetType: node.presetType,
      relativePath: [...node.relativePath],
      savedAtIso: node.savedAtIso,
    };
  }

  const loadPresetTree = async (): Promise<void> => {
    const requestToken = ++presetListRequestToken;
    isPresetLoading = true;
    presetErrorText = null;

    try {
      const response = await bridgeClient.listPresetBrowserTree();
      if (response.status === 'error') {
        throw new Error(response.message);
      }
      if (requestToken !== presetListRequestToken) {
        return;
      }

      presetTree = response.tree.map((node) => mapPresetTreeNode(node) as BrowserTreePresetFolderNode);
      presetErrorText = null;
    } catch (error) {
      if (requestToken !== presetListRequestToken) {
        return;
      }

      presetTree = [];
      presetErrorText = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'Failed to load presets.';
    } finally {
      if (requestToken === presetListRequestToken) {
        isPresetLoading = false;
      }
    }
  };

  const handlePaletteFileChange = async (event: Event): Promise<void> => {
    const input = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : null;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      const payload: PaletteFilePayload = {
        name: file.name,
        content,
      };
      paletteController.applyUploadedPalette(payload);
      playbackSession.renderPreviewFrame();
    } catch (error) {
      void error;
    } finally {
      if (input) {
        input.value = '';
      }
    }
  };

  const handlePaletteReset = (): void => {
    paletteController.resetToDefault();
    playbackSession.renderPreviewFrame();
  };

  const handleLaunchpadModelToggle = (nextEnabled: boolean): void => {
    if (editorSession.commands.setLaunchpadModelEnabled(nextEnabled)) {
      playbackSession.renderPreviewFrame();
    }
  };

  const showPresetMessage = (message: string): void => {
    headerIndicator.show(message);
  };

  const runPresetAction = async (
    action: () => Promise<void>,
    fallbackMessage: string,
  ): Promise<void> => {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : fallbackMessage;
      showPresetMessage(message);
    }
  };

  const showPresetActionMessage = (
    message: string,
    warning?: string,
  ): void => {
    showPresetMessage(warning ? `${message} | ${warning}` : message);
  };

  const resolvePresetInsertSource = (
    sourcePayload: Awaited<ReturnType<typeof bridgeClient.readPresetEntry>>,
  ): BrowserInsertSource | null => {
    if (sourcePayload.status !== 'loaded') {
      return null;
    }

    if (sourcePayload.payload.presetType === 'device') {
      return {
        kind: 'device-preset',
        preset: sourcePayload.payload,
      };
    }

    if (sourcePayload.payload.presetType === 'group') {
      return {
        kind: 'group-preset',
        preset: sourcePayload.payload,
      };
    }

    return null;
  };

  const toReadPresetEntryRequest = (
    entry: BrowserTreePresetLeafNode,
  ): Parameters<typeof bridgeClient.readPresetEntry>[0] => ({
    presetType: entry.presetType,
    relativePath: [...entry.relativePath],
  });

  const handlePresetEntryOpen = async (
    entry: BrowserTreePresetLeafNode,
  ): Promise<void> => {
    if (entry.presetType === 'rack') {
      if (uiState.chainState.devices.length > 0) {
        pendingRackPresetLoadTarget = {
          kind: 'browser-entry',
          entry,
        };
        return;
      }
    }

    await runPresetAction(async () => {
      await loadPresetFromBrowserEntry(entry);
    }, 'Preset load failed.');
  };

  const handlePresetFilePointerDown = async (
    entry: BrowserTreePresetLeafNode,
    sourceEvent: PointerEvent,
    itemEl: HTMLElement,
  ): Promise<void> => {
    if (entry.presetType === 'rack' || sourceEvent.button !== 0 || !sourceEvent.isPrimary) {
      return;
    }

    await runPresetAction(async () => {
      const response = await bridgeClient.readPresetEntry(
        toReadPresetEntryRequest(entry),
      );
      if (response.status === 'error') {
        showPresetMessage(`Preset load failed | ${response.message}`);
        return;
      }

      const source = resolvePresetInsertSource(response);
      if (!source) {
        return;
      }

      editorSession.commands.handleBrowserPointerDown({
        source,
        badgeLabel: `+ ${entry.label}`,
        sourceEvent,
        itemEl,
      });
    }, 'Preset load failed.');
  };

  const handlePresetBrowserContextMenu = (
    clientX: number,
    clientY: number,
    target: ContextMenuTarget,
  ): void => {
    contextMenuComponent?.open(clientX, clientY, target);
  };

  const resolvePresetDeleteLabel = (
    target: Extract<ContextMenuTarget, { kind: 'preset-entry' }>,
  ): string =>
    target.relativePath[target.relativePath.length - 1]
    ?? PRESET_ROOT_LABELS[target.presetType];

  const resolvePresetDeleteTitle = (
    target: Extract<ContextMenuTarget, { kind: 'preset-entry' }>,
  ): string =>
    target.entryKind === 'directory'
      ? 'Move folder to Trash?'
      : 'Move preset to Trash?';

  const resolvePresetDeleteDescription = (
    target: Extract<ContextMenuTarget, { kind: 'preset-entry' }>,
  ): string => {
    const label = resolvePresetDeleteLabel(target);
    return target.entryKind === 'directory'
      ? `The folder "${label}" and everything inside it will be moved to the trash.`
      : `The preset "${label}" will be moved to the trash.`;
  };

  const closePresetDeleteDialog = (): void => {
    if (isPresetDeletePending) {
      return;
    }

    pendingPresetDeleteTarget = null;
  };

  const resolveRackPresetLoadDescription = (
    target: PendingRackPresetLoadTarget,
  ): string =>
    target.kind === 'browser-entry'
      ? `The current rack will be replaced by the rack preset "${target.entry.label}".`
      : 'The current rack will be replaced by the rack preset you choose.';

  const closeRackPresetLoadDialog = (): void => {
    if (isRackPresetLoadPending) {
      return;
    }

    pendingRackPresetLoadTarget = null;
  };

  const loadPresetFromBrowserEntry = async (
    entry: BrowserTreePresetLeafNode,
  ): Promise<void> => {
    const response = await bridgeClient.readPresetEntry(
      toReadPresetEntryRequest(entry),
    );
    if (response.status === 'error') {
      showPresetMessage(`Preset load failed | ${response.message}`);
      return;
    }

    if (response.payload.presetType === 'device') {
      const result = editorSession.commands.insertDevicePreset(
        DEFAULT_PRESET_DROP_ZONE,
        response.payload,
      );
      showPresetActionMessage(result.message, response.warning);
      return;
    }

    if (response.payload.presetType === 'group') {
      const result = editorSession.commands.insertGroupPreset(
        DEFAULT_PRESET_DROP_ZONE,
        response.payload,
      );
      showPresetActionMessage(result.message, response.warning);
      return;
    }

    const result = editorSession.commands.applyRackPreset(response.payload);
    showPresetActionMessage(result.message, response.warning);
  };

  const loadRackPresetFromPicker = async (): Promise<void> => {
    const response = await bridgeClient.openPresetFile({
      presetType: 'rack',
    });
    if (response.status !== 'opened') {
      if (response.status === 'error') {
        showPresetMessage(`Rack preset load failed | ${response.message}`);
      }
      return;
    }

    const result = editorSession.commands.applyRackPreset(response.payload);
    showPresetActionMessage(result.message, response.warning);
  };

  const confirmRackPresetLoad = async (): Promise<void> => {
    const target = pendingRackPresetLoadTarget;
    if (!target || isRackPresetLoadPending) {
      return;
    }

    isRackPresetLoadPending = true;
    try {
      await runPresetAction(async () => {
        if (target.kind === 'browser-entry') {
          await loadPresetFromBrowserEntry(target.entry);
        } else {
          await loadRackPresetFromPicker();
        }
        pendingRackPresetLoadTarget = null;
      }, 'Rack preset load failed.');
    } finally {
      isRackPresetLoadPending = false;
    }
  };

  const confirmPresetBrowserDelete = async (): Promise<void> => {
    const target = pendingPresetDeleteTarget;
    if (!target || isPresetDeletePending) {
      return;
    }

    isPresetDeletePending = true;
    try {
      const response = await bridgeClient.deletePresetEntry({
        presetType: target.presetType,
        relativePath: [...target.relativePath],
        entryKind: target.entryKind,
      });
      if (response.status === 'error') {
        pendingPresetDeleteTarget = null;
        showPresetMessage(`Preset delete failed | ${response.message}`);
        return;
      }

      await loadPresetTree();
      pendingPresetDeleteTarget = null;
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'Preset delete failed.';
      showPresetMessage(`Preset delete failed | ${message}`);
    } finally {
      isPresetDeletePending = false;
    }
  };

  const openPresetDeleteDialog = (
    target: Extract<ContextMenuTarget, { kind: 'preset-entry' }>,
  ): void => {
    pendingPresetDeleteTarget = {
      kind: 'preset-entry',
      presetType: target.presetType,
      relativePath: [...target.relativePath],
      entryKind: target.entryKind,
    };
    isPresetDeletePending = false;
    closeContextMenu();
  };

  const handleShowPresetEntryInFolder = async (
    target: Extract<ContextMenuTarget, { kind: 'preset-entry' | 'presets-root' }>,
  ): Promise<void> => {
    if (target.kind === 'presets-root') {
      const response = await bridgeClient.showPresetsRootInFolder();
      if (response.status === 'error') {
        showPresetMessage(`Show in Folder failed | ${response.message}`);
      }
      return;
    }

    const response = await bridgeClient.showPresetEntryInFolder({
      presetType: target.presetType,
      relativePath: [...target.relativePath],
      entryKind: target.entryKind,
    });
    if (response.status === 'error') {
      showPresetMessage(`Show in Folder failed | ${response.message}`);
    }
  };

  const handleContextMenuDelete = (
    target: ContextMenuTarget,
  ): void => {
    if (target.kind === 'preset-entry') {
      openPresetDeleteDialog(target);
      return;
    }

    editorSession.commands.deleteFromContextTarget(target);
  };

  const savePreset = async (
    request: Parameters<typeof bridgeClient.savePresetFile>[0] | null,
    options: {
      emptyMessage?: string;
      successMessage: string;
      errorSummary: string;
    },
  ): Promise<void> => {
    await runPresetAction(async () => {
      if (!request) {
        if (options.emptyMessage) {
          showPresetMessage(options.emptyMessage);
        }
        return;
      }

      const response = await bridgeClient.savePresetFile(request);
      if (response.status === 'saved') {
        showPresetMessage(options.successMessage);
        return;
      }

      if (response.status === 'error') {
        showPresetMessage(`${options.errorSummary} | ${response.message}`);
      }
    }, `${options.errorSummary}.`);
  };

  const handleSaveDevicePreset = async (deviceId: string): Promise<void> => {
    const payload = buildDevicePresetFile(uiState.chainState, deviceId);
    await savePreset(
      payload
        ? {
          suggestedName: resolveDevicePresetSuggestedName(uiState.chainState, deviceId),
          payload,
        }
        : null,
      {
        emptyMessage: 'Unable to build preset from this device.',
        successMessage: 'Device preset saved.',
        errorSummary: 'Preset save failed',
      },
    );
  };

  const handleSaveGroupPreset = async (groupId: string): Promise<void> => {
    const memberDeviceIds = resolveGroupMemberIds(uiState.chainState.devices, groupId);
    const payload = buildGroupPresetFile(uiState.chainState, groupId, memberDeviceIds);
    await savePreset(
      payload
        ? {
          suggestedName: resolveGroupPresetSuggestedName(uiState.chainState, groupId),
          payload,
        }
        : null,
      {
        emptyMessage: 'Unable to build preset from this group.',
        successMessage: 'Group preset saved.',
        errorSummary: 'Preset save failed',
      },
    );
  };

  const handleSaveRackPreset = async (): Promise<void> => {
    await savePreset(
      {
        suggestedName: 'Rack Preset',
        payload: buildRackPresetFile(uiState.chainState),
      },
      {
        successMessage: 'Rack preset saved.',
        errorSummary: 'Rack preset save failed',
      },
    );
  };

  const handleLoadRackPreset = async (): Promise<void> => {
    if (uiState.chainState.devices.length > 0) {
      pendingRackPresetLoadTarget = {
        kind: 'file-picker',
      };
      return;
    }

    await runPresetAction(async () => {
      await loadRackPresetFromPicker();
    }, 'Rack preset load failed.');
  };

  const handlePresetFileDrop = async (payload: RackPresetFileDrop): Promise<void> => {
    if (payload.fileCount !== 1) {
      showPresetMessage('Drop a single preset file at a time.');
      return;
    }

    let fileText: string;
    try {
      fileText = await payload.file.text();
    } catch {
      showPresetMessage('Preset load failed | Unable to read the dropped file.');
      return;
    }

    const parsed = parsePresetFileText(fileText, {
      fileName: payload.file.name,
      mode: 'recover',
    });
    if (parsed.ok === false) {
      showPresetMessage(`Preset load failed | ${parsed.message}`);
      return;
    }

    if (parsed.preset.presetType === 'rack') {
      showPresetMessage('Rack presets can only be loaded from the rack header loader.');
      return;
    }

    if (!payload.dropZone) {
      showPresetMessage('Drop the preset onto the rack to load it.');
      return;
    }

    const result = parsed.preset.presetType === 'device'
      ? editorSession.commands.insertDevicePreset(
        payload.dropZone,
        parsed.preset,
      )
      : editorSession.commands.insertGroupPreset(
        payload.dropZone,
        parsed.preset,
      );
    showPresetActionMessage(result.message, parsed.warning);
  };

  onMount(() => {
    editorSession.commands.initialize();
    playbackSession.initialize();
    if (uiState.headerIndicatorText.trim()) {
      headerIndicator.show(uiState.headerIndicatorText);
    }
    const disposeBridgeSubscriptions = mountBridgeSubscriptions({
      bridgeClient,
      playbackSession,
      onVersionResolved: (version) => {
        appVersionText = version;
      },
    });
    const disposeKeyboardShortcuts = mountKeyboardShortcuts({
      editorSession,
      closeContextMenu,
      onBeforeUnload: disposeBridgeSubscriptions,
    });

    paletteController.initialize();
    playbackSession.renderPreviewFrame();
    editorSession.commands.scheduleAutoPreview(0);

    return () => {
      disposeKeyboardShortcuts();
      disposeBridgeSubscriptions();
      sendFlow.dispose();
      playbackSession.dispose();
      headerIndicator.dispose();
      editorSession.commands.dispose();
    };
  });

  // Reflect state classes directly on the #app mount element.
  $effect(() => {
    const appEl = document.getElementById('app');
    if (!appEl) return;

    appEl.classList.toggle('is-sidebar-resizing', uiState.isSidebarResizing);
    appEl.style.setProperty('--sidebar-width', `${uiState.sidebarWidthPx}px`);
  });
</script>

<section class="live-main" hidden={uiState.isSettingsOpen}>
    <BrowserPanel
      activePage={uiState.sidebarPage}
      deviceTree={DEVICE_BROWSER_TREE}
      {presetTree}
      {isPresetLoading}
      {presetErrorText}
      onPageSelect={editorSession.commands.setSidebarPage}
      onDeviceAdd={editorSession.commands.addBrowserDevice}
      onBrowserPointerDown={editorSession.commands.handleBrowserPointerDown}
      onOpenContextMenu={handlePresetBrowserContextMenu}
      onPresetEntryOpen={handlePresetEntryOpen}
      onPresetFilePointerDown={handlePresetFilePointerDown}
    />

    <SidebarResizer
      bind:width={uiState.sidebarWidthPx}
      bind:isResizing={uiState.isSidebarResizing}
      isBlocked={rackViewApi?.hasPointerInteraction() ?? false}
      sanitizeWidth={sanitizeSidebarWidth}
      onSave={editorSession.commands.persistSidebarWidth}
    />

    <section class="workspace">
      <header class="workspace-head">
        <div class="workspace-head-left">
          <RackHeaderScrollbar
            metrics={rackScrollMetrics}
            contentRevision={rackMiniMapContentRevision}
            controlsId="chain-devices"
            onScrollRequest={handleRackHeaderScrollRequest}
          />

          <span id="preview-bpm-text" class="header-bpm-text">{bpmText}</span>

          <span
            id="preview-meta"
            class="header-preview-meta"
            class:is-visible={headerIndicator.state.isVisible}
            role="status"
            aria-live="polite"
          >
            {headerIndicator.state.displayText}
          </span>
        </div>

        <div class="workspace-actions">
          <div class="header-length-select">
            <span class="field-label">Length</span>
            <select
              id="auto-create-length-select"
              name="autoCreateLength"
              bind:value={uiState.autoCreateLengthLabel}
              onchange={editorSession.commands.handleAutoCreateLengthChange}
            >
              {#each AUTO_CREATE_LENGTH_OPTIONS as option (option.label)}
                <option value={option.label}>{option.label}</option>
              {/each}
            </select>
          </div>
          <div class="header-preset-group">
            <span class="field-label">Rack</span>
            <Button
              id="rack-preset-save"
              text="Save"
              title="Save the current rack state."
              label="Save rack preset"
              onClick={handleSaveRackPreset}
            />
            <Button
              id="rack-preset-load"
              text="Load"
              title="Replace the current rack with a saved rack preset."
              label="Load rack preset"
              onClick={handleLoadRackPreset}
            />
          </div>
          <Button
            id="undo-button"
            text="Undo"
            disabled={!historyControls.canUndo}
            title={historyControls.canUndo ? `Undo: ${historyControls.undoActionLabel}` : 'Nothing to undo'}
            label={historyControls.canUndo ? `Undo: ${historyControls.undoActionLabel}` : 'Undo unavailable'}
            onClick={handleUndoClick}
          />
          <Button
            id="redo-button"
            text="Redo"
            disabled={!historyControls.canRedo}
            title={historyControls.canRedo ? `Redo: ${historyControls.redoActionLabel}` : 'Nothing to redo'}
            label={historyControls.canRedo ? `Redo: ${historyControls.redoActionLabel}` : 'Redo unavailable'}
            onClick={handleRedoClick}
          />
          <Button
            id="settings-button"
            text="Settings"
            onClick={editorSession.commands.openSettings}
          />
          <Button
            id="send-button"
            variant="primary"
            text={uiState.sendButtonLabel}
            disabled={uiState.sendButtonDisabled}
            onClick={() => sendFlow.send()}
          />
        </div>
      </header>

      <section class="workspace-rack">
        <DeviceRack
          devices={uiState.chainState.devices}
          chainState={uiState.chainState}
          collapsedDeviceIds={uiState.collapsedDeviceIds}
          {paletteRevision}
          currentBeat={playbackSession.state.currentBeat}
          modulationReadoutById={previewState.modulationReadoutById}
          {resolvePaletteRgb}
          isSidebarResizing={uiState.isSidebarResizing}
          interactiveElementSelector={INTERACTIVE_ELEMENT_SELECTOR}
          onSaveChain={editorSession.commands.saveChain}
          onScheduleAutoPreview={editorSession.commands.scheduleAutoPreview}
          onOpenContextMenu={(x, y, target) => contextMenuComponent?.open(x, y, target)}
          onCloseContextMenu={closeContextMenu}
          onCommit={editorSession.commands.handleRackCommit}
          onPresetInsertDrop={editorSession.commands.handlePresetInsertDrop}
          onScrollMetricsChange={handleRackScrollMetricsChange}
          onMiniMapContentRevisionChange={handleRackMiniMapContentRevisionChange}
          onPresetFileDrop={handlePresetFileDrop}
          onSaveDevicePreset={handleSaveDevicePreset}
          onSaveGroupPreset={handleSaveGroupPreset}
          onToggleGroupEnabled={editorSession.commands.toggleGroupEnabled}
          onToggleCollapse={editorSession.commands.toggleCollapse}
          onRenameDevice={editorSession.commands.renameDevice}
          onRenameGroup={editorSession.commands.renameGroup}
          onRackApiReady={(api) => {
            rackViewApi = api;
          }}
        />
        {#if !uiState.isPreviewPopoutOpen}
          <PreviewPanel
            surfaceModel={previewState.surfaceModel}
            onGuideToggle={(enabled) => playbackSession.setPreviewGuideEnabled(enabled)}
            onPopout={() => playbackSession.openPreviewPopout()}
            isPlaying={playbackSession.state.isPlaying}
            loopEnabled={uiState.isPreviewLoopEnabled}
            onPlayClick={() => playbackSession.togglePlayback()}
            onLoopToggle={() => playbackSession.togglePreviewLoop()}
            bind:scrubValue={uiState.previewScrubValue}
            onScrubInput={() => playbackSession.scrubPreview(uiState.previewScrubValue)}
          />
        {/if}
      </section>
    </section>
  </section>

  <section
    id="settings-screen"
    class="settings-screen"
    aria-hidden={uiState.isSettingsOpen ? 'false' : 'true'}
    hidden={!uiState.isSettingsOpen}
  >
    <header class="settings-screen-head">
      <Button
        id="settings-close"
        text="Close"
        onClick={editorSession.commands.closeSettings}
      />
    </header>

    <div class="settings-screen-body">
      <div class="settings-container">
        <!-- Settings -->
        <section class="settings-section">
          <h2 class="settings-section-title">Settings</h2>
          <div class="settings-card">
            <div class="settings-row">
              <div class="info">
                <span class="label">Pro MK2 Mode</span>
                <span class="description">Enable mapping for Launchpad Pro MK2</span>
              </div>
              <input
                id="launchpad-model-mk2"
                type="checkbox"
                checked={uiState.launchpadModel === 'mk2'}
                onchange={(event) => {
                  const target = event.currentTarget as HTMLInputElement;
                  handleLaunchpadModelToggle(target.checked);
                }}
              />
            </div>
            <div class="settings-row">
              <div class="info">
                <span class="label">Color Palette</span>
                <span class="description">{uiState.paletteNameText || 'Default palette'}</span>
              </div>
              
              <div class="settings-actions">
                <Button
                  id="palette-reset"
                  text="Reset to Default"
                  onClick={handlePaletteReset}
                />
                <div class="file-input-wrapper">
                  <div class="file-button">Upload File</div>
                  <input
                    id="palette-file-input"
                    type="file"
                    onchange={handlePaletteFileChange}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- About -->
        <section class="settings-section">
          <h2 class="settings-section-title">About</h2>
          <div class="settings-card">
            <div class="settings-row">
              <div class="info">
                <span class="label">Version</span>
                <span class="description">{appVersionText ? `v${appVersionText}` : 'Loading...'}</span>
              </div>
            </div>
            <div class="settings-row">
              <div class="info">
                <span class="label">sihyunlights</span>
                <span class="description">https://sihyunlights.com</span>
              </div>
              <Button
                text="Visit"
                title="Visit website"
                onClick={() => bridgeClient.openExternal('https://sihyunlights.com')}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  </section>

  <ContextMenu
    bind:this={contextMenuComponent}
    onCopy={editorSession.commands.copyFromContextTarget}
    onCut={editorSession.commands.cutFromContextTarget}
    onPaste={editorSession.commands.pasteFromContextTarget}
    onDuplicate={editorSession.commands.duplicateFromContextTarget}
    onRename={editorSession.commands.beginRenameFromContextTarget}
    onDelete={handleContextMenuDelete}
    onShowInFolder={handleShowPresetEntryInFolder}
    onGroup={editorSession.commands.groupDeviceIds}
    onUngroupGroup={editorSession.commands.ungroupGroup}
    clipboardAvailable={clipboardAvailable}
  />

  <ModalDialog
    open={pendingPresetDeleteTarget !== null}
    title={pendingPresetDeleteTarget ? resolvePresetDeleteTitle(pendingPresetDeleteTarget) : ''}
    description={pendingPresetDeleteTarget ? resolvePresetDeleteDescription(pendingPresetDeleteTarget) : null}
    confirmLabel="Move to Trash"
    cancelLabel="Cancel"
    busy={isPresetDeletePending}
    onConfirm={confirmPresetBrowserDelete}
    onCancel={closePresetDeleteDialog}
  />

  <ModalDialog
    open={pendingRackPresetLoadTarget !== null}
    title="Load rack preset?"
    description={pendingRackPresetLoadTarget ? resolveRackPresetLoadDescription(pendingRackPresetLoadTarget) : null}
    confirmLabel="Load"
    cancelLabel="Cancel"
    busy={isRackPresetLoadPending}
    onConfirm={confirmRackPresetLoad}
    onCancel={closeRackPresetLoadDialog}
  />
