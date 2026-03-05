<script lang="ts">
  /**
   * Main renderer composition root.
   * Delegates editor state/commands to EditorSession while keeping preview/playback orchestration local.
   */
  import { onMount, tick } from 'svelte';

  import type {
    BridgeSettings,
    GenerateAndSendRequest,
    GeneratorChain,
    GeneratorPreview,
    PaletteFilePayload,
    PreviewWindowState,
  } from '../shared/types';
  import {
    AUTO_CREATE_LENGTH_OPTIONS,
  } from '../shared/beat-length';
  import {
    PREVIEW_FRAME_COUNT,
    toPreviewFrameBeat,
    toPreviewFrameIndex,
  } from './services/preview-cache';
  import {
    type CompiledModulationProgram,
    compileModulationProgram,
    evaluateModulationProgramReadouts,
  } from '../core/modulation/compiled-program';
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
  import { generateRendererPreview } from './app/preview';
  import { createPaletteController } from './services/palette';
  import {
    collectActiveVelocityByPitch,
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

  const resolveSourceTimelineEnd = (preview: GeneratorPreview | null): number => {
    if (!preview) {
      return 1;
    }

    let maxEndBeat = 1;
    for (const note of preview.notes) {
      const startBeat = Number.isFinite(note.startBeat) ? note.startBeat : 0;
      const durationBeats = Number.isFinite(note.durationBeats) ? note.durationBeats : 0;
      const endBeat = Math.max(0, startBeat + Math.max(durationBeats, 0));
      if (endBeat > maxEndBeat) {
        maxEndBeat = endBeat;
      }
    }

    return Number.isFinite(maxEndBeat) && maxEndBeat >= 1 ? maxEndBeat : 1;
  };

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
  let deviceRackComponent: ReturnType<typeof DeviceRack> | null = $state(null);
  let playbackScheduler: ReturnType<typeof createPlaybackScheduler> | null = null;
  let contextMenuComponent: ReturnType<typeof ContextMenu> | null = $state(null);
  let previewSurfaceState: PreviewWindowState | null = $state(null);

  const closeContextMenu = (): void => {
    contextMenuComponent?.close();
  };

  const syncRackAfterRender = async (): Promise<void> => {
    await tick();
    deviceRackComponent?.syncAfterRender();
    closeContextMenu();
  };

  const editorSession = createEditorSession({
    autoPreviewDebounceMs: AUTO_PREVIEW_DEBOUNCE_MS,
    historyMaxEntries: HISTORY_MAX_ENTRIES,
    onAutoPreview: () => runPreview(),
    onSyncAfterRender: () => syncRackAfterRender(),
  });
  const uiState = editorSession.state;
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
    resolveLedRgb: (velocity) => paletteController.getLedRgb(velocity, DEFAULT_LED_RGB),
  });

  let previewRevision = $state(0);
  let previewData: GeneratorPreview | null = $state(null);
  let sourceTimelineEnd = $state(1);
  let previewSourceChain: GeneratorChain | null = null;
  let previewLedFrameCache: ReadonlyArray<ReadonlyMap<number, number>> | null = $state(null);
  let compiledProgramCache:
    | {
        chainRef: GeneratorChain;
        program: CompiledModulationProgram;
        modulatorIds: readonly string[];
      }
    | null = null;
  let modulationReadoutById: Record<string, string> = $state({});
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
    if (!deviceRackComponent) {
      return null;
    }

    return {
      getSelectedGroupContexts: () => deviceRackComponent?.getSelectedGroupContexts() ?? [],
      getOrderedSelectedDeviceIds: () => deviceRackComponent?.getOrderedSelectedDeviceIds() ?? [],
      selectAllDevices: (ids) => {
        deviceRackComponent?.selectAllDevices(ids);
      },
      applyNextSelectionAfterDelete: (deviceIds) => {
        deviceRackComponent?.applyNextSelectionAfterDelete(deviceIds);
      },
      clearSelection: () => {
        deviceRackComponent?.clearSelection();
      },
      syncAfterRender: () => {
        deviceRackComponent?.syncAfterRender();
      },
      handleBrowserPointerDown: (event, kind, itemEl) => {
        deviceRackComponent?.handleBrowserPointerDown(event, kind, itemEl);
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

  const EMPTY_ACTIVE_VELOCITY_BY_PITCH = new Map<number, number>();
  const EMPTY_MODULATION_READOUT_BY_ID: Readonly<Record<string, string>> = Object.freeze({});

  const buildLedFrameCache = (
    preview: GeneratorPreview,
    timelineSpanBeats: number,
  ): ReadonlyArray<ReadonlyMap<number, number>> => {
    const frames: Array<ReadonlyMap<number, number>> = [];
    for (let index = 0; index < PREVIEW_FRAME_COUNT; index += 1) {
      frames.push(collectActiveVelocityByPitch(preview, toPreviewFrameBeat(index, timelineSpanBeats)));
    }
    return frames;
  };

  const resolveActiveVelocityByPitchAtBeat = (
    beat: number,
  ): ReadonlyMap<number, number> => {
    if (!previewLedFrameCache || previewLedFrameCache.length === 0) {
      return EMPTY_ACTIVE_VELOCITY_BY_PITCH;
    }
    const frameIndex = toPreviewFrameIndex(beat, sourceTimelineEnd);
    return previewLedFrameCache[frameIndex] ?? EMPTY_ACTIVE_VELOCITY_BY_PITCH;
  };

  const toModulationReadoutMap = (
    chain: GeneratorChain,
    beat01: number,
  ): {
    readoutById: Readonly<Record<string, string>>;
  } => {
    if (!compiledProgramCache || compiledProgramCache.chainRef !== chain) {
      const modulatorIds = chain.devices
        .filter((device) => device.kind === 'modulator')
        .map((device) => device.id);
      compiledProgramCache = {
        chainRef: chain,
        program: compileModulationProgram(chain),
        modulatorIds,
      };
    }

    if (compiledProgramCache.modulatorIds.length === 0) {
      return {
        readoutById: EMPTY_MODULATION_READOUT_BY_ID,
      };
    }

    const baseline: Record<string, string> = {};
    for (const modulatorId of compiledProgramCache.modulatorIds) {
      baseline[modulatorId] = 'No valid target';
    }

    const readouts = evaluateModulationProgramReadouts(
      compiledProgramCache.program,
      beat01,
      uiState.previewLoopLengthBeats,
      { wrap: uiState.isPreviewLoopEnabled },
    );
    for (const readout of readouts) {
      baseline[readout.modulatorId] = [
        `${readout.targetParamKey}`,
        `Current ${readout.modulatedValue.toFixed(3)}`,
        `Base ${readout.baseValue.toFixed(3)}`,
      ].join(' | ');
    }

    return {
      readoutById: baseline,
    };
  };

  const toWrappedLoopBeat01 = (beat: number): number => {
    const safeBeat = Number.isFinite(beat) ? beat : 0;
    const wrapped = ((safeBeat % 1) + 1) % 1;
    if (wrapped === 0 && safeBeat > 0) {
      return 1;
    }
    return wrapped;
  };

  const renderLedFrame = (): void => {
    const timelineEnd = Number.isFinite(sourceTimelineEnd) && sourceTimelineEnd > 0
      ? sourceTimelineEnd
      : resolveSourceTimelineEnd(previewData);
    const beat = clamp(currentBeat, 0, timelineEnd);
    const sourceChain = previewSourceChain ?? uiState.chainState;
    const modulationBeat01 = uiState.isPreviewLoopEnabled
      ? toWrappedLoopBeat01(beat)
      : clamp(beat, 0, 1);
    const modulationRuntime = toModulationReadoutMap(sourceChain, modulationBeat01);
    const activeVelocityByPitch = resolveActiveVelocityByPitchAtBeat(beat);
    modulationReadoutById = modulationRuntime.readoutById;
    const activeCells: PreviewWindowState['activeCells'] = [];
    for (const [pitch, velocity] of activeVelocityByPitch.entries()) {
      activeCells.push({
        pitch,
        rgb: paletteController.getLedRgb(velocity, DEFAULT_LED_RGB),
      });
    }

    previewSurfaceState = {
      activeCells,
      previewRevision,
      launchpadModel: uiState.launchpadModel,
      chain: sourceChain,
      currentBeat: beat,
      sourceTimelineEndBeat: timelineEnd,
      loopLengthBeats: uiState.previewLoopLengthBeats,
      noteCount: previewData?.noteCount ?? 0,
      uniquePitchCount: previewData?.uniquePitchCount ?? 0,
      bpm: uiState.previewBpm,
      isPlaying,
      isLoopEnabled: uiState.isPreviewLoopEnabled,
      isGuideEnabled: uiState.isPreviewGuideEnabled,
    };

    const progress = beat / timelineEnd;
    const nextPreviewScrubValue = Math.round(clamp(progress, 0, 1) * SCRUB_MAX);
    if (uiState.previewScrubValue !== nextPreviewScrubValue) {
      uiState.previewScrubValue = nextPreviewScrubValue;
    }
    previewWindowStatePusher.push({
      activeVelocityByPitch,
      previewRevision,
      currentBeat: beat,
      sourceTimelineEndBeat: timelineEnd,
      loopLengthBeats: uiState.previewLoopLengthBeats,
      launchpadModel: uiState.launchpadModel,
      noteCount: previewData?.noteCount ?? 0,
      uniquePitchCount: previewData?.uniquePitchCount ?? 0,
      bpm: uiState.previewBpm,
      isPlaying,
      isLoopEnabled: uiState.isPreviewLoopEnabled,
      isGuideEnabled: uiState.isPreviewGuideEnabled,
      resolveChain: () => sourceChain,
    });
  };

  const stopPlayback = (): void => {
    playbackScheduler?.stop();
  };

  const startPlayback = (): void => {
    if (!previewData || previewData.noteCount === 0) {
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
  ): void => {
    previewRevision += 1;
    previewData = preview;
    sourceTimelineEnd = resolveSourceTimelineEnd(preview);
    previewSourceChain = sourceChain;
    previewLedFrameCache = buildLedFrameCache(preview, sourceTimelineEnd);
    editorSession.commands.setPreviewLoopLengthBeats(
      bridge?.autoCreateLengthBeats ?? readBridge().autoCreateLengthBeats,
    );
    if (playbackScheduler) {
      playbackScheduler.setCurrentBeat(0);
    } else {
      currentBeat = 0;
      renderLedFrame();
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
      const requestChain = cloneChainForIpc(uiState.chainState);
      const preview = generateRendererPreview(
        requestChain,
        uiState.previewLoopLengthBeats,
        uiState.launchpadModel,
      );
      applyPreviewData(preview, null, 'preview', requestChain);
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
    deviceRackComponent?.setScrollLeft(nextScrollLeft);
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
      renderLedFrame();
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
    renderLedFrame();
  };

  const handleLaunchpadModelToggle = (nextEnabled: boolean): void => {
    if (editorSession.commands.setLaunchpadModelEnabled(nextEnabled)) {
      renderLedFrame();
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
      renderLedFrame();
    }
  };

  const handlePreviewGuideToggle = (nextEnabled: boolean): void => {
    if (editorSession.commands.setPreviewGuideEnabled(nextEnabled)) {
      renderLedFrame();
    }
  };

  const handlePreviewPopout = async (): Promise<void> => {
    try {
      await bridgeClient.openPreviewWindow();
      editorSession.commands.setPreviewPopoutOpen(true);
      renderLedFrame();
    } catch {
      setHeaderIndicatorText('Failed to open preview popout');
    }
  };

  const handlePreviewScrubInput = (): void => {
    const scrubProgress = clamp(Number(uiState.previewScrubValue) / SCRUB_MAX, 0, 1);
    const nextBeat = scrubProgress * sourceTimelineEnd;
    if (playbackScheduler) {
      playbackScheduler.setCurrentBeat(nextBeat);
      return;
    }

    currentBeat = nextBeat;
    renderLedFrame();
  };

  const handleSendClick = async (): Promise<void> => {
    editorSession.commands.cancelAutoPreview();
    clearSendDoneTimer();
    editorSession.commands.setSendButtonState('Sending...', true);
    setHeaderIndicatorText('Sending...', { autoClear: false });

    try {
      const bridge = readBridge();
      editorSession.commands.applyBridgeSettings(bridge, { persist: true });
      const requestChain = cloneChainForIpc(uiState.chainState);

      const request: GenerateAndSendRequest = {
        chain: requestChain,
        bridge,
        launchpadModel: uiState.launchpadModel,
      };
      const response = await bridgeClient.generateAndSend(request);
      applyPreviewData(response.preview, response.bridge, 'send', requestChain);
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
      getLoopEndBeat: () => sourceTimelineEnd,
      isLoopEnabled: () => uiState.isPreviewLoopEnabled,
      onFrame: (nextBeat) => {
        currentBeat = nextBeat;
        renderLedFrame();
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
    renderLedFrame();
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
      isBlocked={!!deviceRackComponent?.hasPointerInteraction()}
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
          bind:this={deviceRackComponent}
          devices={uiState.chainState.devices}
          chainState={uiState.chainState}
          collapsedDeviceIds={uiState.collapsedDeviceIds}
          {paletteRevision}
          {currentBeat}
          {modulationReadoutById}
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
        />
        {#if !uiState.isPreviewPopoutOpen}
          <PreviewPanel
            previewState={previewSurfaceState}
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
    aria-labelledby="settings-title"
    hidden={!uiState.isSettingsOpen}
  >
    <header class="settings-screen-head">
      <h1 id="settings-title">Settings</h1>
      <button id="settings-close" type="button" onclick={editorSession.commands.closeSettings}>
        Close
      </button>
    </header>

    <div class="settings-screen-body">
      <div id="settings-form" class="settings-form">
        <div class="control-field">
          <label for="launchpad-model-mk2" class="field-label">Launchpad MK2 Mode</label>
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
        <div class="control-field">
          <span class="field-label">Palette File</span>
          <input
            id="palette-file-input"
            type="file"
            accept=".txt,.csv,.palette,text/plain"
            onchange={handlePaletteFileChange}
          />
        </div>

        <div class="settings-palette-row">
          <span id="palette-name">{uiState.paletteNameText}</span>
          <button id="palette-reset" type="button" onclick={handlePaletteReset}>
            Reset to Default
          </button>
        </div>
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
