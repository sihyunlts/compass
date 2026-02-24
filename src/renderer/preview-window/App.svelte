<script lang="ts">
  import { onMount } from 'svelte';

  import { clamp } from '../../shared/math';
  import type { PreviewWindowState } from '../../shared/types';
  import PreviewSurface from '../components/PreviewSurface.svelte';

  const toBeatText = (beat: number): string =>
    clamp(Number.isFinite(beat) ? beat : 0, 0, 1).toFixed(3);

  let previewState: PreviewWindowState | null = $state(null);

  const statusText = $derived.by(() => {
    if (!previewState) {
      return 'Waiting for state...';
    }

    return [
      previewState.isPlaying ? 'Playing' : 'Stopped',
      `BPM ${previewState.bpm.toFixed(2)}`,
      previewState.isLoopEnabled ? 'Loop On' : 'Loop Off',
      previewState.isGuideEnabled ? 'Guide On' : 'Guide Off',
    ].join(' | ');
  });

  const metaText = $derived.by(() => {
    if (!previewState) {
      return 'Play or scrub in the main window to mirror preview here.';
    }

    return `Notes ${previewState.noteCount} | Pitches ${previewState.uniquePitchCount} | Beat ${toBeatText(previewState.currentBeat)}`;
  });

  const applyGuideToggle = async (nextEnabled: boolean): Promise<void> => {
    try {
      await window.compass.requestPreviewGuideEnabledUpdate(nextEnabled);
    } catch {
      // If toggle request fails, next state push restores view state.
    }
  };

  const isGuideVisible = (): boolean => previewState?.isGuideEnabled !== false;

  const handleGuideToggle = (): void => {
    void applyGuideToggle(!isGuideVisible());
  };

  onMount(() => {
    const unsubscribe = window.compass.subscribePreviewWindowState((nextState) => {
      previewState = nextState;
    });

    void window.compass.requestPreviewWindowState().then((state) => {
      previewState = state;
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
      previewState={previewState}
    />
    <button
      class="preview-guide-toggle"
      type="button"
      aria-pressed={isGuideVisible() ? 'true' : 'false'}
      onclick={handleGuideToggle}
    >
      {isGuideVisible() ? 'Guide On' : 'Guide Off'}
    </button>
  </div>

  <p id="preview-popout-meta" class="preview-popout-meta">
    {metaText}
  </p>
</section>
