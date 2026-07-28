<script lang="ts">
  import { clamp } from '../../../shared/math';
  import { PREVIEW_SCRUB_MAX } from '../../../shared/contracts/preview/window-state';
  import type { PreviewSurfaceViewModel } from '../../features/preview/view-model';
  import Button from '../primitives/Button.svelte';
  import PreviewSurface from './PreviewSurface.svelte';

  let {
    surfaceModel,
    onPopout,
    isPlaying = false,
    isGenerating = false,
    loopEnabled,
    onPlayClick,
    onLoopToggle,
    scrubValue = $bindable(),
    onScrubInput,
  } = $props<{
    surfaceModel: PreviewSurfaceViewModel;
    onPopout: () => void | Promise<void>;
    isPlaying?: boolean;
    isGenerating?: boolean;
    loopEnabled: boolean;
    onPlayClick: () => void;
    onLoopToggle: () => void;
    scrubValue: number;
    onScrubInput: () => void;
  }>();

  const resolvePlayIcon = (): string => (isPlaying ? 'pause' : 'play_arrow');
  const resolvePlayButtonLabel = (): string =>
    isPlaying ? 'Pause preview' : 'Play preview';
  const resolvePlayButtonHint = (): string =>
    isPlaying ? 'Pause' : 'Play';
  const resolveLoopButtonLabel = (): string =>
    loopEnabled ? 'Disable preview loop' : 'Enable preview loop';
  const resolveLoopButtonHint = (): string =>
    loopEnabled ? 'Unloop' : 'Loop';

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
    <div
      class="preview-panel-scrub-frame"
      class:is-loading={isGenerating}
    >
      <input
        id="preview-scrub"
        class="preview-panel-scrub"
        type="range"
        min="0"
        max={PREVIEW_SCRUB_MAX}
        bind:value={scrubValue}
        style={`--range-fill:${clamp((scrubValue / PREVIEW_SCRUB_MAX) * 100, 0, 100)}%`}
        oninput={onScrubInput}
      />
      {#if isGenerating}
        <div class="preview-panel-scrub-loader" aria-hidden="true">
          <span class="loader-bar"></span>
        </div>
      {/if}
    </div>
  </div>
  <div class="preview-panel-controls">
    <Button
      id="preview-play"
      class="preview-panel-control-button"
      variant="icon"
      label={resolvePlayButtonLabel()}
      title={resolvePlayButtonHint()}
      icon={resolvePlayIcon()}
      onClick={onPlayClick}
    />
    <Button
      id="preview-loop-toggle"
      class="preview-panel-control-button"
      variant="icon"
      label={resolveLoopButtonLabel()}
      title={resolveLoopButtonHint()}
      icon="repeat"
      pressed={loopEnabled}
      onClick={onLoopToggle}
    />
    <Button
      id="preview-popout"
      class="preview-panel-control-button preview-popout-toggle"
      variant="icon"
      label="Open preview in a separate window"
      title="Preview popout"
      icon="open_in_new"
      onClick={handlePopout}
    />
  </div>
</section>

<style lang="scss">
  .preview-panel {
    display: flex;
    gap: var(--gap-8);

    border-left: 1px solid var(--color-border-tertiary);
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

    &-scrub-frame {
      position: relative;
      height: 1rem;

      &.is-loading {
        cursor: progress;

        .preview-panel-scrub {
          opacity: 0;
          pointer-events: none;
        }
      }
    }

    &-scrub {
      height: 1rem;

      &::-webkit-slider-thumb {
        opacity: 0;
      }

      &:hover::-webkit-slider-thumb,
      &:active::-webkit-slider-thumb,
      &:focus-visible::-webkit-slider-thumb {
        opacity: 1;
      }
    }

    &-scrub-loader {
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      height: 0.28rem;
      overflow: hidden;
      border-radius: var(--radius-2);
      background: var(--color-surface-emphasis);
      transform: translateY(-50%);
      pointer-events: none;
    }

    .loader-bar {
      position: absolute;
      inset-block: 0;
      width: 34%;
      border-radius: inherit;
      background: var(--color-indicator-secondary);
      transform: translateX(-120%);
      will-change: transform;
      animation: preview-loader-slide 1.1s ease-in-out infinite;
    }
  }

  @keyframes preview-loader-slide {
    from {
      transform: translateX(-120%);
    }

    to {
      transform: translateX(320%);
    }
  }
</style>
