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
  import { AUTO_CREATE_LENGTH_OPTIONS } from '../shared/beat-length';
  import { sanitizeSidebarWidth } from './features/editor/persistence-storage';
  import BrowserPanel from './components/BrowserPanel.svelte';
  import type {
    BrowserTreeDeviceLeafNode,
    BrowserTreeDeviceFolderNode,
  } from './components/browser-tree-types';
  import type { ContextMenuTarget } from './components/context-menu-types';
  import Button from './components/Button.svelte';
  import SidebarResizer from './components/SidebarResizer.svelte';
  import DeviceRack from './components/DeviceRack.svelte';
  import UndoHistoryControl from './components/UndoHistoryControl.svelte';
  import type {
    RackScrollMetrics,
  } from './components/device-rack-types';
  import RackHeaderScrollbar from './components/RackHeaderScrollbar.svelte';
  import PreviewPanel from './components/PreviewPanel.svelte';
  import ContextMenu from './components/ContextMenu.svelte';
  import ModalDialog from './components/ModalDialog.svelte';
  import WorkspaceRackTitle from './components/WorkspaceRackTitle.svelte';
  import { createPresetController } from './app/preset-controller.svelte';
  import { createSettingsController } from './app/settings-controller.svelte';
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
    selectClipboardAvailable,
    selectHistoryControls,
    selectPreviewBpmText,
  } from './features/editor/selectors';
  import { createPreviewSession } from './features/preview/session.svelte';
  import type { RackViewApi } from './features/rack/api';

  const AUTO_PREVIEW_DEBOUNCE_MS = 120;
  const HISTORY_MAX_ENTRIES = 100;
  const DEFAULT_LED_RGB = '255 166 57';
  const SETTINGS_SIDEBAR_WIDTH_PX = 320;
  const INTERACTIVE_ELEMENT_SELECTOR = 'button, input, select, textarea, option';

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
  let rackViewApi: RackViewApi | null = $state(null);
  let contextMenuComponent: ReturnType<typeof ContextMenu> | null = $state(null);

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
  const historyEntries = $derived.by(() => {
    void uiState.chainRevision;
    return editorSession.listUndoHistoryEntries();
  });
  const bpmText = $derived.by(() => selectPreviewBpmText(uiState.previewBpm));
  const clipboardAvailable = $derived.by(() => selectClipboardAvailable(uiState));
  const headerIndicator = createHeaderIndicator({
    getText: () => uiState.headerIndicatorText,
    setText: (text) => {
      uiState.headerIndicatorText = text;
    },
    clearText: () => {
      uiState.headerIndicatorText = '';
    },
  });
  const presetController = createPresetController({
    bridgeClient,
    editorSession,
    showMessage: (message) => {
      headerIndicator.show(message);
    },
  });
  const settingsController = createSettingsController({
    bridgeClient,
    editorSession,
  });
  const settingsState = settingsController.state;
  const resolvePaletteRgb = (velocity: number): string =>
    settingsController.resolvePaletteRgb(velocity, '0 0 0');
  const playbackSession = createPlaybackSession({
    bridgeClient,
    editorSession,
    previewSession,
    headerIndicator,
    resolveLedRgb: (velocity) => settingsController.resolvePaletteRgb(velocity, DEFAULT_LED_RGB),
  });
  settingsController.attachPlaybackSession(playbackSession);
  const presetState = presetController.state;
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
    editorSession.attachRackBinding(createRackBinding());
  });

  $effect(() => {
    void uiState.headerIndicatorText;
    headerIndicator.syncFromSource();
  });

  $effect(() => {
    if (uiState.sidebarPage !== 'presets') {
      return;
    }

    void presetController.loadTree();
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

  const handleContextMenuDelete = (
    target: ContextMenuTarget,
  ): void => {
    if (target.kind === 'preset-entry') {
      presetController.openPresetDeleteDialog(target);
      closeContextMenu();
      return;
    }

    editorSession.commands.deleteFromContextTarget(target);
  };

  const handleContextMenuCreatePresetFolder = (
    target: Extract<ContextMenuTarget, { kind: 'preset-entry' }>,
  ): void => {
    presetController.beginPresetFolderCreate(target);
    closeContextMenu();
  };

  onMount(() => {
    editorSession.initialize();
    playbackSession.initialize();
    if (uiState.headerIndicatorText.trim()) {
      headerIndicator.show(uiState.headerIndicatorText);
    }
    const disposeBridgeSubscriptions = mountBridgeSubscriptions({
      bridgeClient,
      playbackSession,
      onVersionResolved: (version) => {
        settingsController.setAppVersion(version);
      },
    });
    const disposeKeyboardShortcuts = mountKeyboardShortcuts({
      editorSession,
      closeContextMenu,
      onBeforeUnload: disposeBridgeSubscriptions,
    });

    settingsController.initialize();
    playbackSession.renderPreviewFrame();
    editorSession.scheduleAutoPreview(0);

    return () => {
      disposeKeyboardShortcuts();
      disposeBridgeSubscriptions();
      sendFlow.dispose();
      playbackSession.dispose();
      headerIndicator.dispose();
      settingsController.dispose();
      editorSession.dispose();
    };
  });

  // Reflect state classes directly on the #app mount element.
  $effect(() => {
    const appEl = document.getElementById('app');
    if (!appEl) return;

    appEl.classList.toggle('is-sidebar-resizing', uiState.isSidebarResizing);
    appEl.style.setProperty('--sidebar-width', `${uiState.sidebarWidthPx}px`);
    appEl.style.setProperty(
      '--browser-panel-width',
      `${uiState.sidebarPage === 'settings'
        ? SETTINGS_SIDEBAR_WIDTH_PX
        : uiState.sidebarWidthPx}px`,
    );
  });
</script>

<section class="live-main">
    <BrowserPanel
      activePage={uiState.sidebarPage}
      deviceTree={DEVICE_BROWSER_TREE}
      presetTree={presetState.presetTree}
      isPresetLoading={presetState.isPresetLoading}
      presetErrorText={presetState.presetErrorText}
      pendingPresetFolderDraft={presetState.pendingPresetFolderDraft}
      presetFolderSelectionTarget={presetState.presetFolderSelectionTarget}
      launchpadMk2Enabled={uiState.launchpadModel === 'mk2'}
      paletteDescription={settingsState.paletteDescriptionOverride || uiState.paletteNameText || 'Default palette'}
      paletteDescriptionTone={settingsState.paletteDescriptionTone}
      appVersionText={settingsState.appVersionText}
      aboutDescription={settingsState.aboutDescriptionOverride || settingsController.getAboutSiteUrl()}
      aboutDescriptionTone={settingsState.aboutDescriptionTone}
      onPageSelect={(nextPage) => {
        uiState.sidebarPage = nextPage;
      }}
      onDeviceAdd={editorSession.commands.addBrowserDevice}
      onBrowserPointerDown={editorSession.commands.handleBrowserPointerDown}
      onOpenContextMenu={(x, y, target) => contextMenuComponent?.open(x, y, target)}
      onLaunchpadModelToggle={(enabled) => settingsController.handleLaunchpadModelToggle(enabled)}
      onPaletteReset={() => settingsController.handlePaletteReset()}
      onPaletteFileChange={(event) => settingsController.handlePaletteFileChange(event)}
      onOpenAboutSite={() => settingsController.openAboutSite()}
      onPresetEntryOpen={(entry) => presetController.handlePresetEntryOpen(entry)}
      onPresetFilePointerDown={(entry, sourceEvent, itemEl) =>
        presetController.handlePresetFilePointerDown(entry, sourceEvent, itemEl)}
      onPendingPresetFolderDraftNameChange={(nextName) =>
        presetController.updatePendingPresetFolderDraftName(nextName)}
      onPendingPresetFolderCommit={() => presetController.commitPendingPresetFolderCreate()}
      onPendingPresetFolderCancel={() => presetController.cancelPendingPresetFolderCreate()}
      onPresetFolderSelectionHandled={(token) =>
        presetController.clearPresetFolderSelectionTarget(token)}
    />

    {#if uiState.sidebarPage !== 'settings'}
      <SidebarResizer
        bind:width={uiState.sidebarWidthPx}
        bind:isResizing={uiState.isSidebarResizing}
        isBlocked={rackViewApi?.hasPointerInteraction() ?? false}
        sanitizeWidth={sanitizeSidebarWidth}
        onSave={editorSession.commands.persistSidebarWidth}
      />
    {/if}

    <section class="workspace">
      <header class="workspace-head">
        <div class="workspace-head-left">
          <RackHeaderScrollbar
            metrics={rackScrollMetrics}
            contentRevision={rackMiniMapContentRevision}
            controlsId="chain-devices"
            onScrollRequest={handleRackHeaderScrollRequest}
          />

          <WorkspaceRackTitle
            name={uiState.chainState.name ?? null}
            onCommit={(rawName) => editorSession.commands.renameRack(rawName)}
          />
          <Button
            id="rack-preset-save"
            text="Save"
            title="Save the current rack state."
            label="Save rack preset"
            onClick={() => presetController.handleSaveRackPreset()}
          />

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
          <UndoHistoryControl
            canUndo={historyControls.canUndo}
            undoActionLabel={historyControls.undoActionLabel}
            {historyEntries}
            onUndo={handleUndoClick}
            onCheckout={editorSession.commands.checkoutHistory}
          />
          <Button
            id="redo-button"
            text="Redo"
            disabled={!historyControls.canRedo}
            title={historyControls.canRedo ? `Redo: ${historyControls.redoActionLabel}` : 'Nothing to redo'}
            label={historyControls.canRedo ? `Redo: ${historyControls.redoActionLabel}` : 'Redo unavailable'}
            onClick={handleRedoClick}
          />
          <div class="header-length-select">
            <span id="preview-bpm-text" class="header-bpm-text">{bpmText}</span>
            <select
              id="auto-create-length-select"
              name="autoCreateLength"
              aria-label="Preview length"
              bind:value={uiState.autoCreateLengthLabel}
              onchange={editorSession.commands.handleAutoCreateLengthChange}
            >
              {#each AUTO_CREATE_LENGTH_OPTIONS as option (option.label)}
                <option value={option.label}>{option.label}</option>
              {/each}
            </select>
          </div>
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
          paletteRevision={settingsState.paletteRevision}
          currentBeat={playbackSession.state.currentBeat}
          modulationReadoutById={previewState.modulationReadoutById}
          {resolvePaletteRgb}
          isSidebarResizing={uiState.isSidebarResizing}
          interactiveElementSelector={INTERACTIVE_ELEMENT_SELECTOR}
          onSaveChain={editorSession.commands.saveChain}
          onScheduleAutoPreview={(delayMs) => editorSession.scheduleAutoPreview(delayMs)}
          onOpenContextMenu={(x, y, target) => contextMenuComponent?.open(x, y, target)}
          onCloseContextMenu={closeContextMenu}
          onCommit={editorSession.commands.handleRackCommit}
          onPresetInsertDrop={editorSession.commands.handlePresetInsertDrop}
          onRackPresetDrop={(source) => presetController.openRackPresetDropDialog(source)}
          onScrollMetricsChange={handleRackScrollMetricsChange}
          onMiniMapContentRevisionChange={handleRackMiniMapContentRevisionChange}
          onPresetFileDrop={(payload) => presetController.handlePresetFileDrop(payload)}
          onSaveDevicePreset={(deviceId) => presetController.handleSaveDevicePreset(deviceId)}
          onSaveGroupPreset={(groupId) => presetController.handleSaveGroupPreset(groupId)}
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
            onPopout={() => playbackSession.openPreviewPopout()}
            isPlaying={playbackSession.state.isPlaying}
            loopEnabled={uiState.isPreviewLoopEnabled}
            onPlayClick={() => playbackSession.togglePlayback()}
            onLoopToggle={() => playbackSession.togglePreviewLoop()}
            bind:scrubValue={uiState.previewScrubValue}
            onScrubInput={() => playbackSession.seekPreview(uiState.previewScrubValue)}
          />
        {/if}
      </section>
    </section>
  </section>
  <ContextMenu
    bind:this={contextMenuComponent}
    onCopy={editorSession.commands.copyFromContextTarget}
    onCut={editorSession.commands.cutFromContextTarget}
    onPaste={editorSession.commands.pasteFromContextTarget}
    onDuplicate={editorSession.commands.duplicateFromContextTarget}
    onRename={editorSession.commands.beginRenameFromContextTarget}
    onDelete={handleContextMenuDelete}
    onCreatePresetFolder={handleContextMenuCreatePresetFolder}
    onShowInFolder={(target) => presetController.handleShowPresetEntryInFolder(target)}
    onGroup={editorSession.commands.groupDeviceIds}
    onUngroupGroup={editorSession.commands.ungroupGroup}
    clipboardAvailable={clipboardAvailable}
  />

  <ModalDialog
    open={presetState.pendingPresetDeleteTarget !== null}
    title={presetState.pendingPresetDeleteTarget
      ? presetController.getPresetDeleteTitle(presetState.pendingPresetDeleteTarget)
      : ''}
    description={presetState.pendingPresetDeleteTarget
      ? presetController.getPresetDeleteDescription(presetState.pendingPresetDeleteTarget)
      : null}
    confirmLabel="Move to Trash"
    cancelLabel="Cancel"
    busy={presetState.isPresetDeletePending}
    onConfirm={() => presetController.confirmPresetBrowserDelete()}
    onCancel={() => presetController.closePresetDeleteDialog()}
  />

  <ModalDialog
    open={presetState.pendingRackPresetLoadTarget !== null}
    title="Load rack preset?"
    description={presetState.pendingRackPresetLoadTarget
      ? presetController.getRackPresetLoadDescription(presetState.pendingRackPresetLoadTarget)
      : null}
    confirmLabel="Load"
    cancelLabel="Cancel"
    busy={presetState.isRackPresetLoadPending}
    onConfirm={() => presetController.confirmRackPresetLoad()}
    onCancel={() => presetController.closeRackPresetLoadDialog()}
  />
