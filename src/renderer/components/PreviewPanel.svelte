<script lang="ts">
  import type { PreviewWindowState } from '../../shared/types';
  import PreviewSurface from './PreviewSurface.svelte';

  let {
    previewState,
    onGuideToggle,
    onPopout,
    playLabel,
    loopEnabled,
    onPlayClick,
    onLoopToggle,
  } = $props<{
    previewState: PreviewWindowState | null;
    onGuideToggle: (nextEnabled: boolean) => void;
    onPopout: () => void | Promise<void>;
    playLabel: string;
    loopEnabled: boolean;
    onPlayClick: () => void;
    onLoopToggle: () => void;
  }>();

  const isGuideVisible = (): boolean => previewState?.isGuideEnabled !== false;

  const handleGuideToggle = (): void => {
    onGuideToggle(!isGuideVisible());
  };

  const handlePopout = (): void => {
    void onPopout();
  };
</script>

<section class="preview-panel">
  <PreviewSurface
    mode="rack"
    previewState={previewState}
  />
  <div class="preview-panel-controls">
    <button
      id="preview-play"
      type="button"
      onclick={onPlayClick}
    >
      {playLabel}
    </button>
    <button
      id="preview-loop-toggle"
      class:is-active={loopEnabled}
      type="button"
      aria-pressed={loopEnabled ? 'true' : 'false'}
      onclick={onLoopToggle}
    >
      {loopEnabled ? 'Loop On' : 'Loop Off'}
    </button>
    <button
      id="preview-popout"
      class="preview-popout-toggle"
      type="button"
      onclick={handlePopout}
    >
      Pop Out
    </button>
    <button
      class="preview-guide-toggle"
      type="button"
      aria-pressed={isGuideVisible() ? 'true' : 'false'}
      onclick={handleGuideToggle}
    >
      {isGuideVisible() ? 'Guide On' : 'Guide Off'}
    </button>
  </div>
</section>

<style lang="scss">
  .preview-panel {
    flex: 0 0 auto;
    display: flex;
    align-items: start;
    gap: var(--gap-8);
    height: 100%;
    min-height: 0;
    border-left: 1px solid var(--neutral-20);
    padding: var(--gap-10);

    &-controls {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: var(--gap-6);
      flex: 0 0 auto;
    }
  }

</style>
