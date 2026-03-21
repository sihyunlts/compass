<script lang="ts">
  import { clamp } from '../../shared/math';
  import type { PreviewSurfaceViewModel } from '../features/preview/view-model';
  import IconButton from './IconButton.svelte';
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
  const isPreviewPlaying = (): boolean => playLabel === 'Pause';
  const resolvePlayIcon = (): string => (isPreviewPlaying() ? 'pause' : 'play_arrow');
  const resolvePlayButtonLabel = (): string =>
    isPreviewPlaying() ? 'Pause preview' : 'Play preview';
  const resolveLoopButtonLabel = (): string =>
    loopEnabled ? 'Disable preview loop' : 'Enable preview loop';
  const resolveGuideButtonLabel = (): string =>
    isGuideVisible() ? 'Hide preview guide' : 'Show preview guide';

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
      class="preview-panel-scrub"
      type="range"
      min="0"
      max={SCRUB_MAX}
      bind:value={scrubValue}
      style={`--range-fill:${clamp((scrubValue / SCRUB_MAX) * 100, 0, 100)}%`}
      oninput={onScrubInput}
    />
  </div>
  <div class="preview-panel-controls">
    <IconButton
      id="preview-play"
      label={resolvePlayButtonLabel()}
      icon={resolvePlayIcon()}
      onClick={onPlayClick}
    />
    <IconButton
      id="preview-loop-toggle"
      label={resolveLoopButtonLabel()}
      icon="repeat"
      isActive={loopEnabled}
      isPressed={loopEnabled}
      onClick={onLoopToggle}
    />
    <IconButton
      id="preview-popout"
      class="preview-popout-toggle"
      label="Open preview in a separate window"
      icon="open_in_new"
      onClick={handlePopout}
    />
    <IconButton
      class="preview-guide-toggle"
      label={resolveGuideButtonLabel()}
      icon="grid_guides"
      isActive={isGuideVisible()}
      isPressed={isGuideVisible()}
      onClick={handleGuideToggle}
    />
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

  .preview-panel-scrub {
    margin-block: var(--gap-4);
  }

</style>
