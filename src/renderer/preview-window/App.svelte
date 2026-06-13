<script lang="ts">
  import { onMount } from 'svelte';

  import { clamp } from '../../shared/math';
  import {
    PREVIEW_SCRUB_MAX,
    type PreviewWindowState,
  } from '../../shared/contracts/preview/window-state';
  import { resolveCompassBridge } from '../app/browser-bridge';
  import { createPreviewSession } from '../features/preview/session.svelte';
  import Button from '../components/primitives/Button.svelte';
  import PreviewSurface from '../components/preview/PreviewSurface.svelte';

  const previewSession = createPreviewSession();
  const previewViewState = previewSession.state;
  const bridgeClient = resolveCompassBridge();
  let previewState: PreviewWindowState | null = $state(null);
  let stageWidth = $state(0);
  let stageHeight = $state(0);

  const isPlaying = $derived(previewState?.isPlaying === true);
  const isLoopEnabled = $derived(previewState?.isLoopEnabled === true);
  const isPreviewReady = $derived(previewState !== null && previewState.noteCount > 0);
  const playButtonIcon = $derived(isPlaying ? 'pause' : 'play_arrow');
  const playButtonLabel = $derived(isPlaying ? 'Pause preview' : 'Play preview');
  const loopButtonLabel = $derived(
    isLoopEnabled ? 'Disable preview loop' : 'Enable preview loop',
  );
  const stageSize = $derived(
    stageWidth > 0 && stageHeight > 0
      ? Math.min(stageWidth, stageHeight)
      : null,
  );
  const scrubValue = $derived.by(() => {
    if (!previewState || previewState.sourceTimelineEndBeat <= 0) {
      return 0;
    }

    return Math.round(clamp(
      (previewState.currentBeat / previewState.sourceTimelineEndBeat) * PREVIEW_SCRUB_MAX,
      0,
      PREVIEW_SCRUB_MAX,
    ));
  });

  const handlePlayClick = (): void => {
    bridgeClient.sendPreviewWindowControlRequest({ action: 'toggle-playback' });
  };

  const handleLoopToggle = (): void => {
    bridgeClient.sendPreviewWindowControlRequest({ action: 'toggle-loop' });
  };

  const handleScrubInput = (event: Event): void => {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    bridgeClient.sendPreviewWindowControlRequest({
      action: 'seek',
      scrubValue: Number(input.value),
    });
  };

  onMount(() => {
    const unsubscribe = bridgeClient.subscribePreviewWindowState((nextState) => {
      previewState = nextState;
      previewSession.commands.applyWindowState(nextState);
    });

    void bridgeClient.requestPreviewWindowState().then((state) => {
      previewState = state;
      previewSession.commands.applyWindowState(state);
    }).catch(() => {
      // If initial request fails, live state push still recovers the view.
    });

    return () => {
      unsubscribe();
    };
  });
</script>

<section class="preview-popout-shell">
  <header class="preview-popout-head"></header>

  <main class="preview-popout-panel">
    <div
      class="preview-popout-stage"
      bind:clientWidth={stageWidth}
      bind:clientHeight={stageHeight}
    >
      <PreviewSurface
        mode="popout"
        surfaceModel={previewViewState.surfaceModel}
        sizePx={stageSize}
      />
    </div>

    <div class="preview-popout-actions">
      <Button
        id="preview-popout-play"
        variant="icon"
        label={playButtonLabel}
        icon={playButtonIcon}
        disabled={!isPreviewReady}
        onClick={handlePlayClick}
      />
      <Button
        id="preview-popout-loop"
        variant="icon"
        label={loopButtonLabel}
        icon="repeat"
        pressed={isLoopEnabled}
        onClick={handleLoopToggle}
      />
    </div>

    <input
      id="preview-popout-scrub"
      class="preview-popout-scrub"
      type="range"
      min="0"
      max={PREVIEW_SCRUB_MAX}
      value={scrubValue}
      style={`--range-fill:${clamp((scrubValue / PREVIEW_SCRUB_MAX) * 100, 0, 100)}%`}
      disabled={!previewState}
      oninput={handleScrubInput}
    />
  </main>
</section>
