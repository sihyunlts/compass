<script lang="ts">
  import { clamp } from '../../../shared/math';
  import { PREVIEW_SCRUB_MAX } from '../../../shared/contracts/preview/window-state';
  import type { PreviewSurfaceViewModel } from '../../features/preview/view-model';
  import type {
    HardwareMidiError,
    HardwareMidiOutput,
  } from '../../../shared/contracts/preview/hardware-output';
  import Button from '../primitives/Button.svelte';
  import HardwarePreviewControls from './HardwarePreviewControls.svelte';
  import PreviewSurface from './PreviewSurface.svelte';
  import { i18n } from '../../i18n.svelte';

  let {
    surfaceModel,
    onPopout,
    canPopout = true,
    isPlaying = false,
    isGenerating = false,
    loopEnabled,
    onPlayClick,
    onLoopToggle,
    scrubValue = $bindable(),
    onScrubInput,
    hardwareOutputs,
    selectedHardwareOutputId,
    isHardwareOutputAccessing,
    hardwareOutputError,
    onRefreshHardwareOutputs,
    onSelectHardwareOutput,
  } = $props<{
    surfaceModel: PreviewSurfaceViewModel;
    onPopout: () => void | Promise<void>;
    canPopout?: boolean;
    isPlaying?: boolean;
    isGenerating?: boolean;
    loopEnabled: boolean;
    onPlayClick: () => void;
    onLoopToggle: () => void;
    scrubValue: number;
    onScrubInput: () => void;
    hardwareOutputs: HardwareMidiOutput[];
    selectedHardwareOutputId: string | null;
    isHardwareOutputAccessing: boolean;
    hardwareOutputError: HardwareMidiError | null;
    onRefreshHardwareOutputs: () => void | Promise<void>;
    onSelectHardwareOutput: (outputId: string | null) => void | Promise<void>;
  }>();

  const resolvePlayIcon = (): string => (isPlaying ? 'pause' : 'play_arrow');
  const resolvePlayButtonLabel = (): string =>
    isPlaying ? i18n.t('preview.pauseAria') : i18n.t('preview.playAria');
  const resolvePlayButtonHint = (): string =>
    isPlaying ? i18n.t('preview.pause') : i18n.t('preview.play');
  const resolveLoopButtonLabel = (): string =>
    loopEnabled ? i18n.t('preview.disableLoop') : i18n.t('preview.enableLoop');
  const resolveLoopButtonHint = (): string =>
    loopEnabled ? i18n.t('preview.unloop') : i18n.t('preview.loop');

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
      variant="icon"
      label={resolvePlayButtonLabel()}
      title={resolvePlayButtonHint()}
      icon={resolvePlayIcon()}
      onClick={onPlayClick}
    />
    <Button
      id="preview-loop-toggle"
      variant="icon"
      label={resolveLoopButtonLabel()}
      title={resolveLoopButtonHint()}
      icon="repeat"
      pressed={loopEnabled}
      onClick={onLoopToggle}
    />
    {#if canPopout}
      <Button
        id="preview-popout"
        variant="icon"
        label={i18n.t('preview.openPopout')}
        title={i18n.t('preview.openPopout')}
        icon="open_in_new"
        onClick={handlePopout}
      />
    {/if}
    <HardwarePreviewControls
      outputs={hardwareOutputs}
      selectedOutputId={selectedHardwareOutputId}
      isAccessing={isHardwareOutputAccessing}
      error={hardwareOutputError}
      onRefreshOutputs={onRefreshHardwareOutputs}
      onSelectOutput={onSelectHardwareOutput}
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
