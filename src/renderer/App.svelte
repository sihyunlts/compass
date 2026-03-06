<script lang="ts">
  /**
   * Main renderer composition root.
   * Delegates editor state/commands to EditorSession while keeping preview/playback orchestration local.
   */
  import { onMount, tick } from 'svelte';

  import type { GeneratorChain, LaunchpadModel, PaletteFilePayload } from '../shared/model';
import type { GeneratorPreview } from '../shared/contracts/preview';
import type { GenerateAndSendRequest } from '../shared/contracts/ipc';
import type { BridgeSettings } from '../shared/bridge';
  import {
    AUTO_CREATE_LENGTH_OPTIONS,
  } from '../shared/beat-length';
  import { clamp } from '../shared/math';
  import {
    getBrowserDeviceLabel,
    type BrowserDeviceKind,
  } from './services/devices';
  import {
    sanitizePreviewBpm,
    sanitizeSidebarWidth,
  } from './services/storage';
  import BrowserPanel from './components/BrowserPanel.svelte';
  import SidebarResizer from './components/SidebarResizer.svelte';
  import DeviceRack from './components/DeviceRack.svelte';
  import type { RackScrollMetrics } from './components/device-rack-types';
  import RackHeaderScrollbar from './components/RackHeaderScrollbar.svelte';
  import PreviewPanel from './components/PreviewPanel.svelte';
  import ContextMenu from './components/ContextMenu.svelte';
  import { createPaletteController } from './services/palette';
  import {
    createPlaybackScheduler,
    createPreviewWindowStatePusher,
  } from './services/playback';
  import { cloneChainForIpc } from './services/clone-chain';
  import {
    createEditorSession,
    type EditorRackBinding,
  } from './features/editor/session.svelte';
  import {
    selectClipboardAvailable,
    selectHistoryControls,
    selectPreviewBpmText,
    selectPreviewPanelControls,
  } from './features/editor/selectors';
  import { createPreviewSession } from './features/preview/session.svelte';
  import type { RackViewApi } from './features/rack/api';

  const SCRUB_MAX = 1000;
  const PREVIEW_WINDOW_STATE_MAX_FPS = 120;
  const PREVIEW_WINDOW_STATE_MIN_INTERVAL_MS = Math.round(
    1000 / PREVIEW_WINDOW_STATE_MAX_FPS,
  );
  const AUTO_PREVIEW_DEBOUNCE_MS = 120;
  const HISTORY_MAX_ENTRIES = 100;
  const SEND_DONE_MS = 900;
  const HEADER_INDICATOR_VISIBILITY_MS = 2000;
  const HEADER_INDICATOR_FADE_OUT_MS = 1500;
  const DEFAULT_LED_RGB = '255 166 57';
  const INTERACTIVE_ELEMENT_SELECTOR = 'button, input, select, textarea, option';
  const NON_TEXT_INPUT_TYPES = new Set([
    'checkbox',
    'radio',
    'range',
    'button',
    'submit',
    'reset',
  ]);

  const isTextEditingElement = (element: Element | null): boolean => {
    if (!element) {
      return false;
    }

    if (
      element instanceof HTMLTextAreaElement
      || element instanceof HTMLSelectElement
      || (element instanceof HTMLElement && element.isContentEditable)
    ) {
      return true;
    }

    if (element instanceof HTMLInputElement) {
      const type = element.type.toLowerCase();
      return !NON_TEXT_INPUT_TYPES.has(type);
    }

    return false;
  };

  const toBrowserDragBadgeLabel = (kind: BrowserDeviceKind): string =>
    `+ ${getBrowserDeviceLabel(kind)}`;
  const bridgeClient = window.compass;
  let appVersionText = $state('');
  let rackViewApi: RackViewApi | null = $state(null);
  let playbackScheduler: ReturnType<typeof createPlaybackScheduler> | null = null;
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
    onAutoPreview: () => runPreview(),
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
  const previewWindowStatePusher = createPreviewWindowStatePusher({
    bridgeClient,
    minIntervalMs: PREVIEW_WINDOW_STATE_MIN_INTERVAL_MS,
  });

  let currentBeat = $state(0);
  let isPlaying = $state(false);
  let sendDoneTimer: number | null = null;
  let liveTempoUnsubscribe: (() => void) | null = null;
  let previewWindowVisibilityUnsubscribe: (() => void) | null = null;
  let previewGuideEnabledUnsubscribe: (() => void) | null = null;
  let headerIndicatorTimer: number | null = null;
  let headerIndicatorFadeTimer: number | null = null;
  let headerIndicatorDisplayText = $state('');
  let isHeaderIndicatorVisible = $state(false);
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
      applyNextSelectionAfterDelete: (deviceIds) => {
        rackViewApi?.applyNextSelectionAfterDelete(deviceIds);
      },
      clearSelection: () => {
        rackViewApi?.clearSelection();
      },
      syncAfterRender: () => {
        rackViewApi?.syncAfterRender();
      },
      handleBrowserPointerDown: (event, kind, itemEl) => {
        rackViewApi?.handleBrowserPointerDown(event, kind, itemEl);
      },
    };
  };

  $effect(() => {
    editorSession.commands.attachRackBinding(createRackBinding());
  });

  const clearHeaderIndicatorTimer = (): void => {
    if (headerIndicatorTimer === null) {
      return;
    }
    window.clearTimeout(headerIndicatorTimer);
    headerIndicatorTimer = null;
  };

  const clearHeaderIndicatorFadeTimer = (): void => {
    if (headerIndicatorFadeTimer === null) {
      return;
    }
    window.clearTimeout(headerIndicatorFadeTimer);
    headerIndicatorFadeTimer = null;
  };

  const setHeaderIndicatorText = (
    text: string,
    options: { autoClear?: boolean } = {},
  ): void => {
    editorSession.commands.setHeaderIndicatorText(text);
    clearHeaderIndicatorTimer();
    if (options.autoClear === false) {
      return;
    }

    headerIndicatorTimer = window.setTimeout(() => {
      headerIndicatorTimer = null;
      if (uiState.headerIndicatorText === text) {
        editorSession.commands.clearHeaderIndicatorText();
      }
    }, HEADER_INDICATOR_VISIBILITY_MS);
  };

  $effect(() => {
    const nextText = uiState.headerIndicatorText.trim();
    clearHeaderIndicatorFadeTimer();

    if (nextText) {
      headerIndicatorDisplayText = nextText;
      isHeaderIndicatorVisible = true;
      return;
    }

    if (!headerIndicatorDisplayText) {
      isHeaderIndicatorVisible = false;
      return;
    }

    isHeaderIndicatorVisible = false;
    headerIndicatorFadeTimer = window.setTimeout(() => {
      headerIndicatorFadeTimer = null;
      if (uiState.headerIndicatorText.trim() === '') {
        headerIndicatorDisplayText = '';
      }
    }, HEADER_INDICATOR_FADE_OUT_MS);
  });

  const handleUndoClick = (): void => {
    closeContextMenu();
    editorSession.commands.undo();
  };

  const handleRedoClick = (): void => {
    closeContextMenu();
    editorSession.commands.redo();
  };

  const readBridge = (): BridgeSettings =>
    editorSession.commands.readBridgeSettings();

  const requestLiveTempoSync = async (): Promise<void> => {
    await bridgeClient.requestLiveTempo();
  };

  const runBestEffort = (task: Promise<unknown>): void => {
    void task.catch(() => {
      // Non-critical sync failures should not break the main flow.
    });
  };

  const getPreviewLoopMs = (): number => {
    const bpm = sanitizePreviewBpm(uiState.previewBpm);
    const beats = Math.max(uiState.previewLoopLengthBeats, 0.25);
    return (60000 / bpm) * beats;
  };

  const renderPreviewFrame = (): void => {
    const nextPreviewWindowState = previewSession.commands.renderFrame({
      fallbackChain: uiState.chainState,
      fallbackKey: `chain:${uiState.chainRevision}`,
      launchpadModel: uiState.launchpadModel,
      currentBeat,
      loopLengthBeats: uiState.previewLoopLengthBeats,
      bpm: uiState.previewBpm,
      isPlaying,
      isLoopEnabled: uiState.isPreviewLoopEnabled,
      isGuideEnabled: uiState.isPreviewGuideEnabled,
      resolveLedRgb: (velocity) => paletteController.getLedRgb(velocity, DEFAULT_LED_RGB),
    });

    const progress = nextPreviewWindowState.currentBeat / nextPreviewWindowState.sourceTimelineEndBeat;
    const nextPreviewScrubValue = Math.round(clamp(progress, 0, 1) * SCRUB_MAX);
    if (uiState.previewScrubValue !== nextPreviewScrubValue) {
      uiState.previewScrubValue = nextPreviewScrubValue;
    }

    previewWindowStatePusher.push(nextPreviewWindowState);
  };

  const stopPlayback = (): void => {
    playbackScheduler?.stop();
  };

  const startPlayback = (): void => {
    if (previewState.noteCount === 0) {
      return;
    }

    if (!playbackScheduler || playbackScheduler.isPlaying()) {
      return;
    }

    playbackScheduler.start();
  };

  const applyPreviewData = (
    preview: GeneratorPreview,
    bridge: BridgeSettings | null,
    source: 'preview' | 'send',
    sourceChain: GeneratorChain,
    sourceKey: string,
    previewLaunchpadModel: LaunchpadModel,
  ): void => {
    const nextLoopLengthBeats = bridge?.autoCreateLengthBeats ?? readBridge().autoCreateLengthBeats;
    previewSession.commands.applyPreviewResult({
      preview,
      sourceChain,
      sourceKey,
      loopLengthBeats: nextLoopLengthBeats,
      launchpadModel: previewLaunchpadModel,
    });
    editorSession.commands.setPreviewLoopLengthBeats(nextLoopLengthBeats);
    if (playbackScheduler) {
      playbackScheduler.setCurrentBeat(0);
    } else {
      currentBeat = 0;
      renderPreviewFrame();
    }

    if (preview.noteCount > 0) {
      if (source === 'preview') {
        setHeaderIndicatorText(`${preview.noteCount} notes generated`);
      } else {
        setHeaderIndicatorText('Send complete');
      }
      startPlayback();
      return;
    }

    clearHeaderIndicatorTimer();
    editorSession.commands.clearHeaderIndicatorText();
    stopPlayback();
  };

  const runPreview = async (): Promise<void> => {
    try {
      const sourceKey = `chain:${uiState.chainRevision}`;
      const requestLaunchpadModel = uiState.launchpadModel;
      const requestChain = cloneChainForIpc(uiState.chainState);
      const preview = previewSession.commands.generateRendererPreview({
        sourceChain: requestChain,
        sourceKey,
        loopLengthBeats: uiState.previewLoopLengthBeats,
        launchpadModel: requestLaunchpadModel,
      });
      applyPreviewData(
        preview,
        null,
        'preview',
        requestChain,
        sourceKey,
        requestLaunchpadModel,
      );
    } catch (error) {
      stopPlayback();
      const errorText = error instanceof Error ? error.message : 'Unknown preview error';
      setHeaderIndicatorText(`Preview update failed | ${errorText}`);
    }
  };

  const clearSendDoneTimer = (): void => {
    if (sendDoneTimer !== null) {
      window.clearTimeout(sendDoneTimer);
      sendDoneTimer = null;
    }
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
      renderPreviewFrame();
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
    renderPreviewFrame();
  };

  const handleLaunchpadModelToggle = (nextEnabled: boolean): void => {
    if (editorSession.commands.setLaunchpadModelEnabled(nextEnabled)) {
      renderPreviewFrame();
    }
  };

  const handlePreviewPlayClick = (): void => {
    if (isPlaying) {
      stopPlayback();
      return;
    }

    startPlayback();
  };

  const handlePreviewLoopToggle = (): void => {
    if (editorSession.commands.togglePreviewLoopEnabled()) {
      renderPreviewFrame();
    }
  };

  const handlePreviewGuideToggle = (nextEnabled: boolean): void => {
    if (editorSession.commands.setPreviewGuideEnabled(nextEnabled)) {
      renderPreviewFrame();
    }
  };

  const handlePreviewPopout = async (): Promise<void> => {
    try {
      await bridgeClient.openPreviewWindow();
      editorSession.commands.setPreviewPopoutOpen(true);
      renderPreviewFrame();
    } catch {
      setHeaderIndicatorText('Failed to open preview popout');
    }
  };

  const handlePreviewScrubInput = (): void => {
    const scrubProgress = clamp(Number(uiState.previewScrubValue) / SCRUB_MAX, 0, 1);
    const nextBeat = scrubProgress * previewState.sourceTimelineEndBeat;
    if (playbackScheduler) {
      playbackScheduler.setCurrentBeat(nextBeat);
      return;
    }

    currentBeat = nextBeat;
    renderPreviewFrame();
  };

  const handleSendClick = async (): Promise<void> => {
    editorSession.commands.cancelAutoPreview();
    clearSendDoneTimer();
    editorSession.commands.setSendButtonState('Sending...', true);
    setHeaderIndicatorText('Sending...', { autoClear: false });

    try {
      const bridge = readBridge();
      editorSession.commands.applyBridgeSettings(bridge, { persist: true });
      const sourceKey = `chain:${uiState.chainRevision}`;
      const requestLaunchpadModel = uiState.launchpadModel;
      const requestChain = cloneChainForIpc(uiState.chainState);

      const request: GenerateAndSendRequest = {
        chain: requestChain,
        bridge,
        launchpadModel: requestLaunchpadModel,
      };
      const response = await bridgeClient.generateAndSend(request);
      applyPreviewData(
        response.preview,
        response.bridge,
        'send',
        requestChain,
        sourceKey,
        requestLaunchpadModel,
      );
      editorSession.commands.setSendButtonState('Done!', false);
      sendDoneTimer = window.setTimeout(() => {
        sendDoneTimer = null;
        editorSession.commands.setSendButtonState('Send', false);
      }, SEND_DONE_MS);
    } catch (error) {
      stopPlayback();
      const errorText = error instanceof Error ? error.message : 'Unknown send error';
      setHeaderIndicatorText(`Send failed | ${errorText}`);
      editorSession.commands.setSendButtonState('Send', false);
    }
  };


  onMount(() => {
    editorSession.commands.initialize();
    playbackScheduler = createPlaybackScheduler({
      getLoopMs: () => getPreviewLoopMs(),
      getLoopEndBeat: () => previewState.sourceTimelineEndBeat,
      isLoopEnabled: () => uiState.isPreviewLoopEnabled,
      onFrame: (nextBeat) => {
        currentBeat = nextBeat;
        renderPreviewFrame();
      },
      onPlayStateChange: (nextIsPlaying) => {
        isPlaying = nextIsPlaying;
        editorSession.commands.setPreviewPlaying(nextIsPlaying);
      },
    });

    liveTempoUnsubscribe = bridgeClient.subscribeLiveTempo((update) => {
      if (editorSession.commands.syncPreviewBpm(update.bpm)) {
        setHeaderIndicatorText('BPM synced');
      }
    });

    previewWindowVisibilityUnsubscribe = bridgeClient.subscribePreviewWindowVisibility((isOpen) => {
      editorSession.commands.setPreviewPopoutOpen(isOpen);
    });

    previewGuideEnabledUnsubscribe = bridgeClient.subscribePreviewGuideEnabledUpdate((enabled) => {
      handlePreviewGuideToggle(enabled === true);
    });

    runBestEffort(
      bridgeClient.requestAppVersion().then((version) => {
        appVersionText = version;
      }),
    );

    runBestEffort(
      bridgeClient.requestPreviewWindowVisibility().then((isOpen) => {
        editorSession.commands.setPreviewPopoutOpen(isOpen === true);
      }),
    );

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeContextMenu();
        editorSession.commands.closeSettings();
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      if (isTextEditingElement(target)) {
        return;
      }

      const isGroupShortcut =
        (event.metaKey || event.ctrlKey)
        && event.key.toLowerCase() === 'g';
      if (isGroupShortcut) {
        if (event.shiftKey) {
          if (editorSession.commands.ungroupSelectedGroups()) {
            event.preventDefault();
            closeContextMenu();
          }
          return;
        }

        if (editorSession.commands.groupSelection()) {
          event.preventDefault();
          closeContextMenu();
        }
        return;
      }

      const isModifierShortcut = (event.metaKey || event.ctrlKey) && !event.altKey;
      if (isModifierShortcut) {
        const key = event.key.toLowerCase();
        const isUndoShortcut = key === 'z' && !event.shiftKey;
        if (isUndoShortcut) {
          if (editorSession.commands.undo()) {
            event.preventDefault();
            closeContextMenu();
          }
          return;
        }

        const isRedoShortcut =
          (key === 'z' && event.shiftKey)
          || (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey);
        if (isRedoShortcut) {
          if (editorSession.commands.redo()) {
            event.preventDefault();
            closeContextMenu();
          }
          return;
        }

        if (key === 'c') {
          if (editorSession.commands.copySelection()) {
            event.preventDefault();
            closeContextMenu();
          }
          return;
        }

        if (key === 'x') {
          if (editorSession.commands.cutSelection()) {
            event.preventDefault();
            closeContextMenu();
          }
          return;
        }

        if (key === 'v') {
          if (editorSession.commands.pasteClipboard()) {
            event.preventDefault();
            closeContextMenu();
          }
          return;
        }

        if (key === 'd') {
          if (editorSession.commands.duplicateSelection()) {
            event.preventDefault();
            closeContextMenu();
          }
          return;
        }

        if (key === 'a') {
          if (editorSession.commands.selectAllRackDevices()) {
            event.preventDefault();
            closeContextMenu();
          }
          return;
        }
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }

      if (editorSession.commands.deleteSelection()) {
        event.preventDefault();
        closeContextMenu();
      }
    };

    const handleFocusIn = (event: FocusEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (!isTextEditingElement(target)) {
        return;
      }
      editorSession.commands.clearSelection();
    };

    const handleWindowPointerDown = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) {
        return;
      }

      const rackEl = document.getElementById('chain-devices');
      if (rackEl && rackEl.contains(target)) {
        return;
      }

      editorSession.commands.clearSelection();
    };

    const handleBeforeUnload = (): void => {
      if (liveTempoUnsubscribe) {
        liveTempoUnsubscribe();
        liveTempoUnsubscribe = null;
      }
    };


    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('focusin', handleFocusIn);
    window.addEventListener('pointerdown', handleWindowPointerDown);
    window.addEventListener('beforeunload', handleBeforeUnload);

    runBestEffort(requestLiveTempoSync());

    paletteController.initialize();
    renderPreviewFrame();
    editorSession.commands.scheduleAutoPreview(0);

    return () => {
      playbackScheduler?.teardown();
      playbackScheduler = null;
      previewWindowStatePusher.reset();
      editorSession.commands.dispose();
      clearSendDoneTimer();
      clearHeaderIndicatorTimer();
      clearHeaderIndicatorFadeTimer();

      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('pointerdown', handleWindowPointerDown);
      window.removeEventListener('beforeunload', handleBeforeUnload);

      if (liveTempoUnsubscribe) {
        liveTempoUnsubscribe();
        liveTempoUnsubscribe = null;
      }
      if (previewWindowVisibilityUnsubscribe) {
        previewWindowVisibilityUnsubscribe();
        previewWindowVisibilityUnsubscribe = null;
      }
      if (previewGuideEnabledUnsubscribe) {
        previewGuideEnabledUnsubscribe();
        previewGuideEnabledUnsubscribe = null;
      }
    };
  });

  // Reflect state classes directly on the #app mount element.
  $effect(() => {
    const appEl = document.getElementById('app');
    if (!appEl) return;

    appEl.classList.toggle('is-settings-open', uiState.isSettingsOpen);
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
            class:is-visible={isHeaderIndicatorVisible}
            role="status"
            aria-live="polite"
          >
            {headerIndicatorDisplayText}
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
            onclick={handleSendClick}
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
          {currentBeat}
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
          onToggleGroupEnabled={editorSession.commands.toggleGroupEnabled}
          onToggleCollapse={editorSession.commands.toggleCollapse}
          onRackApiReady={(api) => {
            rackViewApi = api;
          }}
        />
        {#if !uiState.isPreviewPopoutOpen}
          <PreviewPanel
            surfaceModel={previewState.surfaceModel}
            onGuideToggle={handlePreviewGuideToggle}
            onPopout={handlePreviewPopout}
            playLabel={previewPanelControls.playLabel}
            loopEnabled={previewPanelControls.loopEnabled}
            onPlayClick={handlePreviewPlayClick}
            onLoopToggle={handlePreviewLoopToggle}
            bind:scrubValue={uiState.previewScrubValue}
            onScrubInput={handlePreviewScrubInput}
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
    onDelete={editorSession.commands.deleteFromContextTarget}
    onGroup={editorSession.commands.groupDeviceIds}
    onUngroupGroup={editorSession.commands.ungroupGroup}
    clipboardAvailable={clipboardAvailable}
  />
