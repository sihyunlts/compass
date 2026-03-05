<script lang="ts">
  import { clamp } from '../../shared/math';
  import type { PreviewSurfaceViewModel } from '../features/preview/view-model';
  import PreviewSurface from './PreviewSurface.svelte';

  const SCRUB_MAX = 1000;

  let {
    surfaceModel,
    onGuideToggle,
    onPopout,
    playLabel,
    loopEnabled,
    onPlayClick,
    onLoopToggle,
    scrubValue = $bindable(),
    onScrubInput,
  } = $props<{
    surfaceModel: PreviewSurfaceViewModel;
    onGuideToggle: (nextEnabled: boolean) => void;
    onPopout: () => void | Promise<void>;
    playLabel: string;
    loopEnabled: boolean;
    onPlayClick: () => void;
    onLoopToggle: () => void;
    scrubValue: number;
    onScrubInput: () => void;
  }>();

  const isGuideVisible = (): boolean => surfaceModel.isGuideEnabled;

  const handleGuideToggle = (): void => {
    onGuideToggle(!isGuideVisible());
  };

  const handlePopout = (): void => {
    void onPopout();
  };
</script>

<section class="preview-panel">
  <div class="preview-panel-main">
    <PreviewSurface
      mode="rack"
      {surfaceModel}
    />
    <input
      id="preview-scrub"
      type="range"
      min="0"
      max={SCRUB_MAX}
      bind:value={scrubValue}
      style={`--range-fill:${clamp((scrubValue / SCRUB_MAX) * 100, 0, 100)}%`}
      oninput={onScrubInput}
    />
  </div>
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
    display: flex;
    gap: var(--gap-8);

    border-left: 1px solid var(--neutral-20);
    padding: var(--gap-10);

    &-main {
      display: flex;
      flex-direction: column;
      gap: var(--gap-8);
    }

    &-controls {
      display: flex;
      flex-direction: column;
      gap: var(--gap-6);
    }
  }

</style>
