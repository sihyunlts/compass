<script lang="ts">
  import { clamp } from '../../shared/math';
  import type { PreviewSurfaceViewModel } from '../features/preview/view-model';
  import Button from './Button.svelte';
  import PreviewSurface from './PreviewSurface.svelte';

  const SCRUB_MAX = 1000;

  let {
    surfaceModel,
    onGuideToggle,
    onPopout,
    isPlaying = false,
    loopEnabled,
    onPlayClick,
    onLoopToggle,
    scrubValue = $bindable(),
    onScrubInput,
  } = $props<{
    surfaceModel: PreviewSurfaceViewModel;
    onGuideToggle: (nextEnabled: boolean) => void;
    onPopout: () => void | Promise<void>;
    isPlaying?: boolean;
    loopEnabled: boolean;
    onPlayClick: () => void;
    onLoopToggle: () => void;
    scrubValue: number;
    onScrubInput: () => void;
  }>();

  const isGuideVisible = (): boolean => surfaceModel.isGuideEnabled;
  const resolvePlayIcon = (): string => (isPlaying ? 'pause' : 'play_arrow');
  const resolvePlayButtonLabel = (): string =>
    isPlaying ? 'Pause preview' : 'Play preview';
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
    <Button
      id="preview-play"
      variant="icon"
      label={resolvePlayButtonLabel()}
      icon={resolvePlayIcon()}
      onClick={onPlayClick}
    />
    <Button
      id="preview-loop-toggle"
      variant="icon"
      label={resolveLoopButtonLabel()}
      icon="repeat"
      pressed={loopEnabled}
      onClick={onLoopToggle}
    />
    <Button
      id="preview-popout"
      class="preview-popout-toggle"
      variant="icon"
      label="Open preview in a separate window"
      icon="open_in_new"
      onClick={handlePopout}
    />
    <Button
      class="preview-guide-toggle"
      variant="icon"
      label={resolveGuideButtonLabel()}
      icon="grid_guides"
      pressed={isGuideVisible()}
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
