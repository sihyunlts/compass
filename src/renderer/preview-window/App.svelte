<script lang="ts">
  import { onMount } from 'svelte';

  import type { PreviewWindowState } from '../../shared/contracts/preview/window-state';
  import { createPreviewSession } from '../features/preview/session.svelte';
  import PreviewSurface from '../components/preview/PreviewSurface.svelte';

  const toBeatText = (beat: number): string =>
    (Number.isFinite(beat) ? beat : 0).toFixed(3);

  const previewSession = createPreviewSession();
  const previewViewState = previewSession.state;
  let previewState: PreviewWindowState | null = $state(null);

  const statusText = $derived.by(() => {
    if (!previewState) {
      return 'Waiting for state...';
    }

    return [
      previewState.isPlaying ? 'Playing' : 'Stopped',
      `BPM ${previewState.bpm.toFixed(2)}`,
      previewState.isLoopEnabled ? 'Loop On' : 'Loop Off',
    ].join(' | ');
  });

  const metaText = $derived.by(() => {
    if (!previewState) {
      return 'Play or scrub in the main window to mirror preview here.';
    }

    return `Notes ${previewState.noteCount} | Pitches ${previewState.uniquePitchCount} | Beat ${toBeatText(previewState.currentBeat)}`;
  });

  onMount(() => {
    const unsubscribe = window.compass.subscribePreviewWindowState((nextState) => {
      previewState = nextState;
      previewSession.commands.applyWindowState(nextState);
    });

    void window.compass.requestPreviewWindowState().then((state) => {
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
  <header class="preview-popout-head">
    <h1>Preview</h1>
    <span id="preview-popout-status">{statusText}</span>
  </header>

  <div class="preview-popout-stage">
    <PreviewSurface
      mode="popout"
      surfaceModel={previewViewState.surfaceModel}
    />
  </div>

  <p id="preview-popout-meta" class="preview-popout-meta">
    {metaText}
  </p>
</section>
