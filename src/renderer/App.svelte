<script lang="ts">
  /**
   * Main renderer composition root.
   * Delegates non-visual orchestration to renderer/app modules and keeps UI wiring here.
   */
  import { onMount, tick, untrack } from 'svelte';

  import { clamp } from '../shared/math';
  import { AUTO_CREATE_LENGTH_OPTIONS } from '../shared/beat-length';
  import { DEVICE_BROWSER_TREE } from './features/editor/device-browser-categories';
  import {
    loadMainWindowAlwaysOnTop,
    sanitizeSidebarWidth,
    saveMainWindowAlwaysOnTop,
  } from './features/editor/persistence-storage';
  import BrowserPanel from './components/browser/BrowserPanel.svelte';
  import type { BrowserPage } from './features/browser/types';
  import {
    isPresetDeleteContextTarget,
    type ContextMenuTarget,
  } from './features/context-menu/types';
  import Button from './components/primitives/Button.svelte';
  import DropdownSelect from './components/primitives/DropdownSelect.svelte';
  import SidebarResizer from './components/layout/SidebarResizer.svelte';
  import DeviceRack from './components/rack/DeviceRack.svelte';
  import UndoHistoryControl from './components/history/UndoHistoryControl.svelte';
  import type {
    RackScrollMetrics,
  } from './features/rack/types';
  import RackHeaderScrollbar from './components/rack/RackHeaderScrollbar.svelte';
  import PreviewPanel from './components/preview/PreviewPanel.svelte';
  import ContextMenu from './components/overlays/ContextMenu.svelte';
  import ModalDialog from './components/overlays/ModalDialog.svelte';
  import AuthoredInfoDialog from './components/overlays/AuthoredInfoDialog.svelte';
  import WorkspaceRackTitle from './components/rack/WorkspaceRackTitle.svelte';
  import { createPresetController } from './app/preset-controller.svelte';
  import { createSettingsController } from './app/settings-controller.svelte';
  import { mountBridgeSubscriptions } from './app/bridge-subscriptions';
  import { resolveCompassBridge } from './app/browser-bridge';
  import { createHeaderIndicator } from './app/header-indicator.svelte';
  import { mountKeyboardShortcuts } from './app/keyboard-shortcuts';
  import { createPlaybackSession } from './app/playback-session.svelte';
  import { createResultDeliveryFlow } from './app/result-delivery-flow';
  import { setKaguyaThemeEnabled } from './app/theme';
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
  import {
    loadBadAppleAnimation,
    resolveBadApplePreviewFrame,
    type BadAppleAnimation,
  } from './features/preview/bad-apple';
  import type { RackViewApi } from './features/rack/api';
  import { i18n } from './i18n.svelte';
  import { resolveHistoryActionLabel } from './features/editor/history-i18n';
  import { createAuthoredInfoController } from './app/authored-info-controller.svelte';

  const AUTO_PREVIEW_DEBOUNCE_MS = 120;
  const HISTORY_MAX_ENTRIES = 100;
  const DEFAULT_LED_RGB = '255 166 57';
  const SETTINGS_SIDEBAR_WIDTH_PX = 320;
  const INTERACTIVE_ELEMENT_SELECTOR = 'button, input, textarea';

  const bridgeClient = resolveCompassBridge();
  const isWebFallback = !window.compass;
  const resultDeliveryMode = isWebFallback ? 'midi-download' : 'ableton';
  const hasWindowsTitlebarControls = navigator.userAgent.includes('Windows');
  const reserveBrowserTitlebarSpace = !isWebFallback && !hasWindowsTitlebarControls;
  let rackViewApi: RackViewApi | null = $state(null);
  let contextMenuComponent: ReturnType<typeof ContextMenu> | null = $state(null);
  let mainWindowAlwaysOnTop = $state(loadMainWindowAlwaysOnTop());

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
    onAutoPreview: ({ restartPlayback }) => playbackSession.runPreview({
      restartPlayback,
    }),
    onSyncAfterRender: () => syncRackAfterRender(),
  });
  const previewSession = createPreviewSession();
  let badAppleAnimation: BadAppleAnimation | null = $state(null);
  const uiState = editorSession.state;
  const previewState = previewSession.state;
  const deliveryButtonMessageKeys = {
    idle: isWebFallback ? 'status.download' : 'status.send',
    working: isWebFallback ? 'status.downloading' : 'status.sending',
  } as const;
  const deliveryButtonText = $derived.by(() =>
    i18n.t(
      uiState.deliveryButtonState === 'done'
        ? 'status.done'
        : deliveryButtonMessageKeys[uiState.deliveryButtonState],
    ));
  const historyControls = $derived.by(() => selectHistoryControls(uiState));
  const localizedRedoActionLabel = $derived(
    historyControls.redoActionKind
      ? resolveHistoryActionLabel(historyControls.redoActionKind)
      : '',
  );
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
  const authoredInfoController = createAuthoredInfoController({
    bridgeClient,
    editorSession,
    presetController,
    showMessage: (message) => {
      headerIndicator.show(message);
    },
  });
  const authoredInfoState = authoredInfoController.state;
  const settingsController = createSettingsController({
    bridgeClient,
    editorSession,
  });
  const presetState = presetController.state;
  const settingsState = settingsController.state;
  const paletteDescription = $derived.by(() => {
    if (settingsState.paletteDescriptionOverride) {
      return settingsState.paletteDescriptionOverride;
    }

    if (uiState.paletteSource === 'loading') {
      return i18n.t('settings.paletteLoading');
    }
    if (uiState.paletteSource === 'fallback') {
      return i18n.t('settings.paletteFallback');
    }
    return i18n.t(
      uiState.paletteSource === 'custom'
        ? 'settings.paletteCustom'
        : 'settings.paletteDefault',
      { name: uiState.paletteName },
    );
  });
  const resolvePaletteRgb = (velocity: number): string =>
    settingsController.resolvePaletteRgb(velocity, '0 0 0');
  const playbackSession = createPlaybackSession({
    bridgeClient,
    editorSession,
    previewSession,
    headerIndicator,
    resolveLedRgb: (velocity) => settingsController.resolvePaletteRgb(velocity, DEFAULT_LED_RGB),
    resolvePreviewVisual: ({ elapsedMs, launchpadModel }) => {
      if (
        presetState.currentRackDisplayName.trim().toLowerCase() !== 'bad apple'
        || !badAppleAnimation
      ) {
        return null;
      }
      return resolveBadApplePreviewFrame(badAppleAnimation, elapsedMs, launchpadModel);
    },
    onPreviewVisualStart: () => {
      headerIndicator.show('BAD APPLE!!', { priority: 'high' });
    },
  });
  settingsController.attachPlaybackSession(playbackSession);
  let isRackRevertDialogOpen = $state(false);
  const resultDeliveryFlow = createResultDeliveryFlow({
    bridgeClient,
    editorSession,
    headerIndicator,
    playbackSession,
    mode: resultDeliveryMode,
  });

  let rackScrollMetrics: RackScrollMetrics = $state({
    scrollLeft: 0,
    scrollWidth: 1,
    clientWidth: 1,
  });
  let rackMiniMapContentRevision = $state(0);
  const currentPreviewBeatBeats = $derived(playbackSession.state.currentBeat);
  const isKaguyaRack = $derived(
    presetState.currentRackDisplayName.trim().toLowerCase() === 'kaguya',
  );
  const isBadAppleRack = $derived(
    presetState.currentRackDisplayName.trim().toLowerCase() === 'bad apple',
  );
  const currentPreviewProgress01 = $derived.by(() => {
    const sourceTimelineEndBeat = previewState.sourceTimelineEndBeat;
    if (!Number.isFinite(sourceTimelineEndBeat) || sourceTimelineEndBeat <= 0) {
      return 0;
    }

    return clamp(currentPreviewBeatBeats / sourceTimelineEndBeat, 0, 1);
  });

  $effect(() => {
    void uiState.chainRevision;
    void uiState.collapsedDeviceIds;
    void presetState.currentRackFilePath;
    void presetState.isRackDirty;
    presetController.syncMainWindowDocumentState();
  });

  $effect(() => {
    void uiState.chainRevision;
    untrack(() => playbackSession.renderPreviewFrame());
  });

  $effect(() => {
    const enabled = isBadAppleRack;
    untrack(() => {
      playbackSession.setPreviewVisualEnabled(enabled);
    });
    const shouldLoadAnimation = enabled && untrack(() => !badAppleAnimation);
    if (shouldLoadAnimation) {
      void loadBadAppleAnimation().then((animation) => {
        badAppleAnimation = animation;
      }).catch(() => {
        // The rack preview remains available if the optional easter egg asset fails.
        playbackSession.setPreviewVisualEnabled(false);
      });
    }
  });

  $effect(() => {
    const enabled = isKaguyaRack;
    setKaguyaThemeEnabled(enabled);
    if (enabled) {
      untrack(() => {
        headerIndicator.show('かぐやっほー！', { priority: 'high' });
      });
    }
    return () => {
      if (enabled) {
        setKaguyaThemeEnabled(false);
      }
    };
  });

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

  const handleSidebarPageSelect = (nextPage: BrowserPage): void => {
    uiState.sidebarPage = nextPage;
  };

  const handleUndoClick = (): void => {
    closeContextMenu();
    editorSession.commands.undo();
  };

  const handleRedoClick = (): void => {
    closeContextMenu();
    editorSession.commands.redo();
  };

  const openRackRevertDialog = (): void => {
    isRackRevertDialogOpen = true;
  };

  const closeRackRevertDialog = (): void => {
    isRackRevertDialogOpen = false;
  };

  const confirmRackRevertDialog = (): void => {
    isRackRevertDialogOpen = false;
    presetController.handleRevertRack();
  };

  const handlePreviewLengthChange = (nextValue: string | number): void => {
    uiState.autoCreateLengthLabel = String(nextValue);
    editorSession.commands.handleAutoCreateLengthChange();
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
    if (isPresetDeleteContextTarget(target)) {
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

  const handleContextMenuRename = (
    target: ContextMenuTarget,
  ): void => {
    if (target.kind === 'preset-entry') {
      presetController.beginPresetEntryRename(target);
      closeContextMenu();
      return;
    }

    editorSession.commands.beginRenameFromContextTarget(target);
  };

  const syncMainWindowAlwaysOnTop = async (): Promise<void> => {
    if (isWebFallback) {
      return;
    }

    const actual = mainWindowAlwaysOnTop
      ? await bridgeClient.setMainWindowAlwaysOnTop(true)
      : await bridgeClient.requestMainWindowAlwaysOnTop();
    mainWindowAlwaysOnTop = actual;
    saveMainWindowAlwaysOnTop(actual);
  };

  const handleMainWindowAlwaysOnTopToggle = async (): Promise<void> => {
    if (isWebFallback) {
      return;
    }

    const actual = await bridgeClient.setMainWindowAlwaysOnTop(!mainWindowAlwaysOnTop);
    mainWindowAlwaysOnTop = actual;
    saveMainWindowAlwaysOnTop(actual);
  };

  onMount(() => {
    void bridgeClient.setApplicationLocale(i18n.locale);
    void loadBadAppleAnimation().then((animation) => {
      badAppleAnimation = animation;
    }).catch(() => {
      // The normal rack preview is the fallback when the optional asset is unavailable.
      playbackSession.setPreviewVisualEnabled(false);
    });
    editorSession.initialize();
    playbackSession.initialize();
    void presetController.loadTree();
    if (uiState.headerIndicatorText.trim()) {
      headerIndicator.show(uiState.headerIndicatorText);
    }
    const disposeBridgeSubscriptions = mountBridgeSubscriptions({
      bridgeClient,
      playbackSession,
      onVersionResolved: (version) => {
        settingsController.setAppVersion(version);
      },
      onUpdateCheckResolved: (result) => {
        settingsController.setUpdateCheckResult(result);
      },
    });
    const disposeKeyboardShortcuts = mountKeyboardShortcuts({
      editorSession,
      closeContextMenu,
      interactiveElementSelector: INTERACTIVE_ELEMENT_SELECTOR,
      onNewRack: () => presetController.handleNewRack(),
      onSaveRack: () => presetController.handleSaveRack(),
      onSaveRackAs: () => presetController.handleSaveRackAs(),
      onBeforeUnload: disposeBridgeSubscriptions,
    });
    const disposeMainWindowCloseRequest = bridgeClient.subscribeMainWindowCloseRequest(() => {
      void presetController.handleMainWindowCloseRequest();
    });
    const disposePresetBrowserTreeChanged =
      bridgeClient.subscribePresetBrowserTreeChanged(() => {
        void presetController.loadTree();
      });
    const disposeMainWindowRackFileMenuRequest = bridgeClient.subscribeMainWindowRackFileMenuRequest(
      (action) => {
        if (action === 'new') {
          void presetController.handleNewRack();
          return;
        }

        if (action === 'save') {
          void presetController.handleSaveRack();
          return;
        }

        void presetController.handleSaveRackAs();
      },
    );
    const disposePreviewWindowControlRequest = bridgeClient.subscribePreviewWindowControlRequest(
      (request) => {
        if (request.action === 'toggle-playback') {
          playbackSession.togglePlayback();
          return;
        }

        if (request.action === 'toggle-loop') {
          playbackSession.togglePreviewLoop();
          return;
        }

        uiState.previewScrubValue = request.scrubValue;
        playbackSession.seekPreview(uiState.previewScrubValue);
      },
    );

    settingsController.initialize();
    void syncMainWindowAlwaysOnTop();
    playbackSession.renderPreviewFrame();
    editorSession.scheduleAutoPreview(0);

    return () => {
      disposePreviewWindowControlRequest();
      disposePresetBrowserTreeChanged();
      disposeMainWindowRackFileMenuRequest();
      disposeMainWindowCloseRequest();
      disposeKeyboardShortcuts();
      disposeBridgeSubscriptions();
      resultDeliveryFlow.dispose();
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
    document.documentElement.classList.toggle(
      'reduce-animation',
      settingsState.reduceAnimation,
    );
    appEl.style.setProperty('--sidebar-width', `${uiState.sidebarWidthPx}px`);
    appEl.style.setProperty(
      '--browser-panel-width',
      `${uiState.sidebarPage === 'settings'
        ? SETTINGS_SIDEBAR_WIDTH_PX
        : uiState.sidebarWidthPx}px`,
    );
  });
</script>

<section
  class="live-main"
  class:has-windows-titlebar-controls={hasWindowsTitlebarControls}
>
    <BrowserPanel
      reserveTitlebarSpace={reserveBrowserTitlebarSpace}
      canToggleWindowLayer={!isWebFallback}
      {mainWindowAlwaysOnTop}
      locale={i18n.locale}
      reduceAnimation={settingsState.reduceAnimation}
      themePreset={settingsState.themePreset}
      themeHue={settingsState.themeHue}
      themeSaturation={settingsState.themeSaturation}
      activePage={uiState.sidebarPage}
      deviceTree={DEVICE_BROWSER_TREE}
      presetTree={presetState.presetTree}
      presetOccupiedPaths={presetState.presetOccupiedPaths}
      presetErrorText={presetState.presetErrorText}
      pendingPresetFolderDraft={presetState.pendingPresetFolderDraft}
      presetEntrySelectionTarget={presetState.presetEntrySelectionTarget}
      launchpadMk2Enabled={uiState.launchpadModel === 'mk2'}
      {paletteDescription}
      paletteDescriptionTone={settingsState.paletteDescriptionTone}
      paletteRevision={settingsState.paletteRevision}
      {resolvePaletteRgb}
      appVersionText={settingsState.appVersionText}
      updateCheckText={settingsState.updateCheckText}
      updateAvailable={settingsState.updateAvailable}
      aboutDescription={settingsState.aboutDescriptionOverride || settingsController.getAboutSiteUrl()}
      aboutDescriptionTone={settingsState.aboutDescriptionTone}
      githubDescription="sihyunlts/compass"
      onPageSelect={(nextPage) => {
        void handleSidebarPageSelect(nextPage);
      }}
      onMainWindowAlwaysOnTopToggle={() => void handleMainWindowAlwaysOnTopToggle()}
      onLocaleChange={(locale) => {
        i18n.setLocale(locale);
        presetController.syncLocaleDependentDefaults();
        playbackSession.renderPreviewFrame();
        void bridgeClient.setApplicationLocale(locale);
      }}
      onReduceAnimationToggle={(enabled) =>
        settingsController.handleReduceAnimationToggle(enabled)}
      onThemePresetChange={(presetId) =>
        settingsController.handleThemePresetChange(presetId)}
      onThemeHueChange={(hue) => settingsController.handleThemeHueChange(hue)}
      onThemeSaturationChange={(saturation) =>
        settingsController.handleThemeSaturationChange(saturation)}
      onDeviceAdd={editorSession.commands.addBrowserDevice}
      onBrowserPointerDown={editorSession.commands.handleBrowserPointerDown}
      onOpenContextMenu={(x, y, target) => contextMenuComponent?.open(x, y, target)}
      onLaunchpadModelToggle={(enabled) => settingsController.handleLaunchpadModelToggle(enabled)}
      onPaletteReset={() => settingsController.handlePaletteReset()}
      onPaletteFileChange={(event) => settingsController.handlePaletteFileChange(event)}
      onOpenAboutSite={() => settingsController.openAboutSite()}
      onOpenGitHub={() => settingsController.openGitHub()}
      onOpenLatestReleasePage={() => settingsController.openLatestReleasePage()}
      onPresetEntryOpen={(entry) => presetController.handlePresetEntryOpen(entry)}
      onRackPresetPreviewLoad={(entry) =>
        presetController.loadRackPresetForPreview(entry)}
      onPresetFilePointerDown={(entry, sourceEvent, itemEl, dragSignal) =>
        presetController.handlePresetFilePointerDown(
          entry,
          sourceEvent,
          itemEl,
          dragSignal,
        )}
      onPendingPresetFolderDraftNameChange={(nextName) =>
        presetController.updatePendingPresetFolderDraftName(nextName)}
      onPendingPresetFolderDraftCommit={() => presetController.commitPendingPresetFolderDraft()}
      onPendingPresetFolderDraftCancel={() => presetController.cancelPendingPresetFolderDraft()}
      onPresetEntriesMove={(entries, destination) =>
        presetController.movePresetEntries(entries, destination)}
      onPresetEntrySelectionHandled={(token) =>
        presetController.clearPresetEntrySelectionTarget(token)}
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
            title={presetState.currentRackDisplayName}
            dirty={presetState.isRackDirty}
            disabled={presetState.isRackPresetLoadPending}
            onNewRack={() => presetController.handleNewRack()}
            onSaveRack={() => presetController.handleSaveRack()}
            onSaveRackAs={() => presetController.handleSaveRackAs()}
            onRevertRack={openRackRevertDialog}
            canRevertRack={presetState.canRevertRack && presetState.isRackDirty}
            onEditRackInfo={authoredInfoController.openRack}
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
            undoActionKind={historyControls.undoActionKind}
            {historyEntries}
            onUndo={handleUndoClick}
            onCheckout={editorSession.commands.checkoutHistory}
          />
          <Button
            id="redo-button"
            text={i18n.t('history.redo')}
            disabled={!historyControls.canRedo}
            title={historyControls.canRedo
              ? i18n.t('history.redoAction', { action: localizedRedoActionLabel })
              : i18n.t('history.nothingToRedo')}
            label={historyControls.canRedo
              ? i18n.t('history.redoAction', { action: localizedRedoActionLabel })
              : i18n.t('history.redoUnavailable')}
            onClick={handleRedoClick}
          />
          <div class="header-length-select">
            <span id="preview-bpm-text" class="header-bpm-text">{bpmText}</span>
            <DropdownSelect
              value={uiState.autoCreateLengthLabel}
              options={AUTO_CREATE_LENGTH_OPTIONS.map((option) => ({
                value: option.label,
                label: option.label,
              }))}
              ariaLabel={i18n.t('preview.length')}
              showHint
              onValueChange={handlePreviewLengthChange}
            />
          </div>
          <Button
            id="delivery-button"
            variant="primary"
            text={deliveryButtonText}
            disabled={uiState.deliveryButtonState === 'working'}
            onClick={() =>
              resultDeliveryFlow.deliver(presetState.currentRackDisplayName)}
          />
        </div>
      </header>

      <section class="workspace-rack">
        <DeviceRack
          devices={uiState.chainState.devices}
          chainState={uiState.chainState}
          collapsedDeviceIds={uiState.collapsedDeviceIds}
          paletteRevision={settingsState.paletteRevision}
          currentBeatBeats={currentPreviewBeatBeats}
          currentProgress01={currentPreviewProgress01}
          modulationReadoutById={previewState.modulationReadoutById}
          modulationStateByParameter={previewState.modulationStateByParameter}
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
          getFilePath={(file) => bridgeClient.getPathForFile(file)}
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
            canPopout={!isWebFallback}
            isPlaying={playbackSession.state.isPlaying}
            isGenerating={playbackSession.state.isPreviewGenerating}
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
    onRename={handleContextMenuRename}
    onInfo={authoredInfoController.openFromContextTarget}
    onDelete={handleContextMenuDelete}
    onCreatePresetFolder={handleContextMenuCreatePresetFolder}
    onShowInFolder={(target) => presetController.handleShowPresetEntryInFolder(target)}
    onGroup={editorSession.commands.groupDeviceIds}
    onUngroupGroup={editorSession.commands.ungroupGroup}
    onDisconnectModulation={editorSession.commands.disconnectModulation}
    clipboardAvailable={clipboardAvailable}
  />

  <AuthoredInfoDialog
    open={authoredInfoState.target !== null}
    title={authoredInfoController.title}
    name={authoredInfoState.name}
    author={authoredInfoState.author}
    description={authoredInfoState.description}
    savedAtIso={authoredInfoState.savedAtIso}
    busy={authoredInfoState.isPending}
    onNameChange={(value) => {
      authoredInfoState.name = value;
    }}
    onAuthorChange={(value) => {
      authoredInfoState.author = value;
    }}
    onDescriptionChange={(value) => {
      authoredInfoState.description = value;
    }}
    onConfirm={authoredInfoController.confirm}
    onCancel={authoredInfoController.close}
  />

  <ModalDialog
    open={isRackRevertDialogOpen}
    title={i18n.t('rack.revertPrompt')}
    description={i18n.t('rack.revertDescription')}
    confirmLabel={i18n.t('rack.revert')}
    cancelLabel={i18n.t('app.cancel')}
    defaultAction="confirm"
    onConfirm={confirmRackRevertDialog}
    onCancel={closeRackRevertDialog}
  />

  <ModalDialog
    open={presetState.pendingPresetDeleteTarget !== null}
    title={presetState.pendingPresetDeleteTarget
      ? presetController.getPresetDeleteTitle(presetState.pendingPresetDeleteTarget)
      : ''}
    description={presetState.pendingPresetDeleteTarget
      ? presetController.getPresetDeleteDescription(presetState.pendingPresetDeleteTarget)
      : null}
    confirmLabel={i18n.t('rack.trash')}
    cancelLabel={i18n.t('app.cancel')}
    busy={presetState.isPresetDeletePending}
    defaultAction="confirm"
    onConfirm={() => presetController.confirmPresetBrowserDelete()}
    onCancel={() => presetController.closePresetDeleteDialog()}
  />

  <ModalDialog
    open={presetState.pendingRackPresetLoadTarget !== null}
    title={i18n.t('rack.saveCurrentPrompt')}
    description={presetState.pendingRackPresetLoadTarget
      ? presetController.getRackPresetLoadDescription(presetState.pendingRackPresetLoadTarget)
      : null}
    confirmLabel={i18n.t('rack.save')}
    secondaryLabel={i18n.t('rack.dontSave')}
    cancelLabel={i18n.t('app.cancel')}
    busy={presetState.isRackPresetLoadPending}
    defaultAction="confirm"
    onConfirm={() => presetController.confirmRackSaveBeforeLoad()}
    onSecondary={() => presetController.confirmRackDiscardBeforeLoad()}
    onCancel={() => presetController.closeRackPresetLoadDialog()}
  />
