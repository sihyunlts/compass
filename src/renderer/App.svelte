<script lang="ts">
  /**
   * Main renderer composition root.
   * Delegates non-visual orchestration to renderer/app modules and keeps UI wiring here.
   */
  import { onMount, tick } from 'svelte';

  import {
    getRendererDeviceLabel,
    type RendererDeviceKind,
  } from '../devices';
  import type { PaletteFilePayload } from '../shared/model';
  import { parsePresetFileText } from '../shared/presets';
  import { AUTO_CREATE_LENGTH_OPTIONS } from '../shared/beat-length';
  import { sanitizeSidebarWidth } from './features/editor/persistence-storage';
  import BrowserPanel from './components/BrowserPanel.svelte';
  import SidebarResizer from './components/SidebarResizer.svelte';
  import DeviceRack from './components/DeviceRack.svelte';
  import type {
    RackPresetFileDrop,
    RackScrollMetrics,
  } from './components/device-rack-types';
  import RackHeaderScrollbar from './components/RackHeaderScrollbar.svelte';
  import PreviewPanel from './components/PreviewPanel.svelte';
  import ContextMenu from './components/ContextMenu.svelte';
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
    selectPreviewPanelControls,
  } from './features/editor/selectors';
  import { resolveGroupMemberIds } from './features/editor/chain-ops';
  import { createPreviewSession } from './features/preview/session.svelte';
  import type { RackViewApi } from './features/rack/api';

  const AUTO_PREVIEW_DEBOUNCE_MS = 120;
  const HISTORY_MAX_ENTRIES = 100;
  const DEFAULT_LED_RGB = '255 166 57';
  const INTERACTIVE_ELEMENT_SELECTOR = 'button, input, select, textarea, option';

  const toBrowserDragBadgeLabel = (kind: RendererDeviceKind): string =>
    `+ ${getRendererDeviceLabel(kind)}`;
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
  const previewPanelControls = $derived.by(() => selectPreviewPanelControls(uiState));
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
      handleBrowserPointerDown: (event, kind, itemEl) => {
        rackViewApi?.handleBrowserPointerDown(event, kind, itemEl);
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
          presetType: 'device',
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
          presetType: 'group',
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
        presetType: 'rack',
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
    await runPresetAction(async () => {
      const response = await bridgeClient.openPresetFile({
        presetType: 'rack',
      });
      if (response.status !== 'opened') {
        if (response.status === 'error') {
          showPresetMessage(`Rack preset load failed | ${response.message}`);
        }
        return;
      }

      if (response.payload.presetType !== 'rack') {
        showPresetMessage('Preset type does not match the rack loader.');
        return;
      }

      const result = editorSession.commands.applyRackPreset(response.payload);
      showPresetActionMessage(result.message, response.warning);
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
    });
    if (parsed.ok === false) {
      showPresetMessage(`Preset load failed | ${parsed.message}`);
      return;
    }

    if (parsed.preset.presetType === 'rack') {
      showPresetMessage('Rack presets can only be loaded from the rack header loader.');
      return;
    }

    if (!payload.targets.dropZone) {
      showPresetMessage('Drop the preset onto the rack to load it.');
      return;
    }

    const result = parsed.preset.presetType === 'device'
      ? editorSession.commands.insertDevicePreset(
        payload.targets.dropZone,
        parsed.preset,
      )
      : payload.targets.dropZone.kind === 'inside-group'
        ? editorSession.commands.replaceGroupPreset(
          payload.targets.dropZone.groupId,
          parsed.preset,
        )
        : editorSession.commands.insertGroupPreset(
          payload.targets.dropZone,
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
      onDeviceAdd={editorSession.commands.addBrowserDevice}
      onBrowserPointerDown={editorSession.commands.handleBrowserPointerDown}
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
            <button
              id="rack-preset-save"
              type="button"
              title="Save the current rack state."
              aria-label="Save rack preset"
              onclick={handleSaveRackPreset}
            >
              Save
            </button>
            <button
              id="rack-preset-load"
              type="button"
              title="Replace the current rack with a saved rack preset."
              aria-label="Load rack preset"
              onclick={handleLoadRackPreset}
            >
              Load
            </button>
          </div>
          <button
            id="undo-button"
            type="button"
            disabled={!historyControls.canUndo}
            title={historyControls.canUndo ? `Undo: ${historyControls.undoActionLabel}` : 'Nothing to undo'}
            aria-label={historyControls.canUndo ? `Undo: ${historyControls.undoActionLabel}` : 'Undo unavailable'}
            onclick={handleUndoClick}
          >
            Undo
          </button>
          <button
            id="redo-button"
            type="button"
            disabled={!historyControls.canRedo}
            title={historyControls.canRedo ? `Redo: ${historyControls.redoActionLabel}` : 'Nothing to redo'}
            aria-label={historyControls.canRedo ? `Redo: ${historyControls.redoActionLabel}` : 'Redo unavailable'}
            onclick={handleRedoClick}
          >
            Redo
          </button>
          <button id="settings-button" type="button" onclick={editorSession.commands.openSettings}>
            Settings
          </button>
          <button
            id="send-button"
            class="primary"
            type="button"
            disabled={uiState.sendButtonDisabled}
            onclick={() => sendFlow.send()}
          >
            {uiState.sendButtonLabel}
          </button>
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
          onGetBrowserDragBadgeLabel={toBrowserDragBadgeLabel}
          onCommit={editorSession.commands.handleRackCommit}
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
            playLabel={previewPanelControls.playLabel}
            loopEnabled={previewPanelControls.loopEnabled}
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
      <button id="settings-close" type="button" onclick={editorSession.commands.closeSettings}>
        Close
      </button>
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
                <button id="palette-reset" type="button" onclick={handlePaletteReset}>
                  Reset to Default
                </button>
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
              <button
                type="button"
                title="Visit website"
                onclick={() => bridgeClient.openExternal('https://sihyunlights.com')}
              >
                Visit
              </button>
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
    onDelete={editorSession.commands.deleteFromContextTarget}
    onGroup={editorSession.commands.groupDeviceIds}
    onUngroupGroup={editorSession.commands.ungroupGroup}
    clipboardAvailable={clipboardAvailable}
  />
