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
  import type {
    RackScrollMetrics,
  } from './components/device-rack-types';
  import RackHeaderScrollbar from './components/RackHeaderScrollbar.svelte';
  import PreviewPanel from './components/PreviewPanel.svelte';
  import ContextMenu from './components/ContextMenu.svelte';
  import ModalDialog from './components/ModalDialog.svelte';
  import { createPaletteController } from './app/palette-controller';
  import { createPresetController } from './app/preset-controller.svelte';
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
  let appVersionText = $state('');
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
  const bpmText = $derived.by(() => selectPreviewBpmText(uiState.previewBpm));
  const clipboardAvailable = $derived.by(() => selectClipboardAvailable(uiState));

  let paletteRevision = $state(0);
  const paletteController = createPaletteController({
    onPaletteNameChanged: (nameText) => {
      editorSession.state.paletteNameText = nameText;
      paletteRevision += 1;
    },
  });
  const resolvePaletteRgb = (velocity: number): string =>
    paletteController.getLedRgb(velocity, '0 0 0');
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
  const presetState = presetController.state;
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
    editorSession.scheduleAutoPreview(0);

    return () => {
      disposeKeyboardShortcuts();
      disposeBridgeSubscriptions();
      sendFlow.dispose();
      playbackSession.dispose();
      headerIndicator.dispose();
      editorSession.dispose();
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
      presetTree={presetState.presetTree}
      isPresetLoading={presetState.isPresetLoading}
      presetErrorText={presetState.presetErrorText}
      onPageSelect={(nextPage) => {
        uiState.sidebarPage = nextPage;
      }}
      onDeviceAdd={editorSession.commands.addBrowserDevice}
      onBrowserPointerDown={editorSession.commands.handleBrowserPointerDown}
      onOpenContextMenu={(x, y, target) => contextMenuComponent?.open(x, y, target)}
      onPresetEntryOpen={(entry) => presetController.handlePresetEntryOpen(entry)}
      onPresetFilePointerDown={(entry, sourceEvent, itemEl) =>
        presetController.handlePresetFilePointerDown(entry, sourceEvent, itemEl)}
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
              onClick={() => presetController.handleSaveRackPreset()}
            />
            <Button
              id="rack-preset-load"
              text="Load"
              title="Replace the current rack with a saved rack preset."
              label="Load rack preset"
              onClick={() => presetController.handleLoadRackPreset()}
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
            onClick={() => {
              uiState.isSettingsOpen = true;
            }}
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
          onScheduleAutoPreview={(delayMs) => editorSession.scheduleAutoPreview(delayMs)}
          onOpenContextMenu={(x, y, target) => contextMenuComponent?.open(x, y, target)}
          onCloseContextMenu={closeContextMenu}
          onCommit={editorSession.commands.handleRackCommit}
          onPresetInsertDrop={editorSession.commands.handlePresetInsertDrop}
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
        onClick={() => {
          uiState.isSettingsOpen = false;
        }}
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
