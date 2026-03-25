<svelte:options runes={true} />

<script lang="ts">
  import { clamp } from '../../shared/math';

  const SNAP_DIVISION_OPTIONS = [4, 8, 16, 32] as const;
  type TimeWindowEditorMode = 'stretch' | 'trim';

  let {
    deviceId,
    dataAction,
    start,
    end,
    mode,
    modeBadgeText = null,
    currentProgress01,
  } = $props<{
    deviceId: string;
    dataAction: string;
    start: number;
    end: number;
    mode: TimeWindowEditorMode;
    modeBadgeText?: string | null;
    currentProgress01?: number;
  }>();

  let snapDivisions = $state<number>(16);

  const resolvedStart = $derived(Number.isFinite(start) ? start : 0);
  const resolvedEnd = $derived(Number.isFinite(end) ? end : 0);
  const clampedStart = $derived(clamp(resolvedStart, 0, 1));
  const clampedEnd = $derived(clamp(resolvedEnd, 0, 1));
  const hasValidWindow = $derived(
    Number.isFinite(start)
    && Number.isFinite(end)
    && start >= 0
    && end <= 1
    && end > start,
  );
  const visibleStart = $derived(hasValidWindow ? clampedStart : 0);
  const visibleEnd = $derived(hasValidWindow ? clampedEnd : 0);
  const windowLengthText = $derived(
    hasValidWindow ? (visibleEnd - visibleStart).toFixed(3) : 'Invalid',
  );
  const modeLabel = $derived(mode === 'stretch' ? 'Stretch Output' : 'Trim Output');
  const modeHintText = $derived(
    mode === 'stretch'
      ? 'Full clip is placed into the selected window.'
      : 'Selected window becomes the whole clip.',
  );
  const normalizedPlayhead = $derived(
    clamp(Number.isFinite(currentProgress01) ? currentProgress01 : 0, 0, 1),
  );
  const showsPlayhead = $derived(currentProgress01 !== undefined && currentProgress01 !== null);
  const rangeStep = $derived(1 / snapDivisions);
  const ticks = $derived.by(() =>
    Array.from({ length: snapDivisions + 1 }, (_, index) => ({
      index,
      ratio: index / snapDivisions,
      isMajor: index === 0 || index === snapDivisions || index % Math.max(1, snapDivisions / 4) === 0,
    })));

  const setSnapDivisions = (nextDivisions: number): void => {
    snapDivisions = nextDivisions;
  };
</script>

<div class="time-window-editor">
  <div class="time-window-toolbar">
    <div class="time-window-meta">
      <span class="field-label">{modeLabel}</span>
      <span class="time-window-hint">{modeHintText}</span>
    </div>
    {#if modeBadgeText}
      <span class="time-window-badge">{modeBadgeText}</span>
    {/if}
    <div class="time-window-snap" role="group" aria-label="Snap divisions">
      {#each SNAP_DIVISION_OPTIONS as divisions (divisions)}
        <button
          class:selected={snapDivisions === divisions}
          type="button"
          onclick={() => setSnapDivisions(divisions)}
        >
          {divisions}
        </button>
      {/each}
    </div>
  </div>

  <div class="time-window-ruler" aria-hidden="true">
    <span>0</span>
    <span>0.5</span>
    <span>1</span>
  </div>

  <div
    class="time-window-surface"
    class:is-stretch={mode === 'stretch'}
    class:is-trim={mode === 'trim'}
    class:is-invalid={!hasValidWindow}
    style={`--window-start:${visibleStart * 100}%;--window-end:${visibleEnd * 100}%;--playhead:${normalizedPlayhead * 100}%;`}
  >
    <div class="time-window-track" aria-hidden="true">
      <div class="time-window-outside time-window-outside-start"></div>
      <div class="time-window-outside time-window-outside-end"></div>
      <div class="time-window-selected-span"></div>
      {#if showsPlayhead}
        <div class="time-window-playhead"></div>
      {/if}
      {#each ticks as tick (tick.index)}
        <span
          class="time-window-tick"
          class:is-major={tick.isMajor}
          style={`left:${tick.ratio * 100}%;`}
        ></span>
      {/each}
    </div>

    <div class="time-window-handle-layer">
      <input
        class="time-window-range time-window-range-start"
        type="range"
        min="0"
        max="1"
        step={rangeStep}
        value={clampedStart}
        data-action={dataAction}
        data-id={deviceId}
        data-param="start"
        aria-label="Window start"
      />
      <input
        class="time-window-range time-window-range-end"
        type="range"
        min="0"
        max="1"
        step={rangeStep}
        value={clampedEnd}
        data-action={dataAction}
        data-id={deviceId}
        data-param="end"
        aria-label="Window end"
      />
    </div>
  </div>

  <div class="time-window-inputs">
    <div class="control-field">
      <span class="field-label">Start</span>
      <input
        type="number"
        min="0"
        max="1"
        step="0.001"
        value={resolvedStart}
        data-action={dataAction}
        data-id={deviceId}
        data-param="start"
      />
    </div>
    <div class="control-field">
      <span class="field-label">End</span>
      <input
        type="number"
        min="0"
        max="1"
        step="0.001"
        value={resolvedEnd}
        data-action={dataAction}
        data-id={deviceId}
        data-param="end"
      />
    </div>
    <div class="control-field">
      <span class="field-label">Length</span>
      <input type="text" value={windowLengthText} readonly tabindex="-1" />
    </div>
  </div>
</div>

<style lang="scss">
  .time-window-editor {
    --time-window-accent: var(--device-category-accent, var(--category-time-500));
    display: flex;
    flex-direction: column;
    gap: var(--gap-8);
  }

  .time-window-toolbar,
  .time-window-ruler,
  .time-window-inputs {
    display: flex;
    align-items: flex-start;
  }

  .time-window-toolbar {
    justify-content: flex-start;
    align-items: center;
    gap: var(--gap-8);
  }

  .time-window-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-right: auto;
  }

  .time-window-hint {
    color: var(--neutral-50);
    font-size: var(--text-12);
    line-height: 1.2;
  }

  .time-window-badge {
    display: inline-flex;
    align-items: center;
    height: 1.5rem;
    padding: 0 var(--gap-8);
    border-radius: 999px;
    background: rgb(var(--rgb-white) / 0.06);
    color: var(--neutral-00);
    font-size: var(--text-12);
    white-space: nowrap;
  }

  .time-window-snap {
    display: inline-flex;
    gap: var(--gap-4);

    button {
      border: 0;
      min-width: 2rem;
      height: 1.5rem;
      border-radius: var(--radius-4);
      background: var(--neutral-20);
      color: var(--neutral-50);
      cursor: pointer;

      &.selected {
        background: var(--time-window-accent);
        color: var(--neutral-00);
      }
    }
  }

  .time-window-ruler {
    justify-content: space-between;
    color: var(--neutral-50);
    font-size: var(--text-12);
  }

  .time-window-surface {
    position: relative;
    border: 1px solid var(--neutral-30);
    border-radius: var(--radius-6);
    background:
      linear-gradient(180deg, rgb(var(--rgb-white) / 0.02), transparent),
      var(--neutral-10);
    padding: var(--gap-10) var(--gap-10) var(--gap-12);

    &.is-invalid {
      border-color: var(--time-window-accent);

      .time-window-selected-span {
        opacity: 0;
      }
    }
  }

  .time-window-track {
    position: relative;
    height: 2.25rem;
    border-radius: var(--radius-4);
    background:
      linear-gradient(180deg, rgb(var(--rgb-white) / 0.02), transparent),
      var(--neutral-20);
    overflow: hidden;
  }

  .time-window-outside,
  .time-window-selected-span,
  .time-window-playhead,
  .time-window-tick {
    position: absolute;
  }

  .time-window-outside {
    top: 0;
    bottom: 0;
    background: rgb(var(--rgb-black) / 0.18);
    pointer-events: none;
  }

  .time-window-outside-start {
    left: 0;
    width: var(--window-start, 0%);
  }

  .time-window-outside-end {
    left: var(--window-end, 0%);
    right: 0;
  }

  .time-window-selected-span {
    top: 0;
    bottom: 0;
    left: var(--window-start, 0%);
    width: calc(var(--window-end, 0%) - var(--window-start, 0%));
    min-width: 0;
    background:
      linear-gradient(180deg, rgb(var(--rgb-white) / 0.14), rgb(var(--rgb-white) / 0.04)),
      var(--time-window-accent);
    opacity: 0.88;
  }

  .time-window-surface.is-stretch {
    .time-window-selected-span {
      background:
        linear-gradient(180deg, rgb(var(--rgb-white) / 0.1), rgb(var(--rgb-white) / 0.02)),
        var(--time-window-accent);
      box-shadow:
        inset 0 0 0 1px rgb(var(--rgb-white) / 0.12),
        0 0 0 1px rgb(var(--rgb-black) / 0.18);
    }

    .time-window-outside {
      background: rgb(var(--rgb-black) / 0.28);
    }
  }

  .time-window-surface.is-trim {
    .time-window-selected-span {
      background:
        repeating-linear-gradient(
          135deg,
          rgb(var(--rgb-white) / 0.18) 0,
          rgb(var(--rgb-white) / 0.18) 6px,
          rgb(var(--rgb-white) / 0.04) 6px,
          rgb(var(--rgb-white) / 0.04) 12px
        ),
        linear-gradient(180deg, rgb(var(--rgb-white) / 0.12), rgb(var(--rgb-white) / 0.02)),
        var(--time-window-accent);
      opacity: 0.94;
    }

    .time-window-outside {
      background: rgb(var(--rgb-black) / 0.12);
    }
  }

  .time-window-playhead {
    top: 0;
    bottom: 0;
    left: var(--playhead, 0%);
    width: 2px;
    background: var(--time-window-accent);
    transform: translateX(-1px);
    box-shadow: 0 0 0 1px rgb(var(--rgb-white) / 0.12);
  }

  .time-window-tick {
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgb(var(--rgb-white) / 0.05);
    transform: translateX(-0.5px);

    &.is-major {
      background: rgb(var(--rgb-white) / 0.14);
    }
  }

  .time-window-handle-layer {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--gap-8);
    margin-top: calc(-1 * var(--gap-20));
    padding-top: var(--gap-4);
  }

  .time-window-range {
    position: relative;
    z-index: 1;
    --range-fill: 0%;
    --range-fill-color: transparent;
    --range-track-color: transparent;

    &::-webkit-slider-runnable-track {
      height: 0.9rem;
      background: transparent;
    }

    &::-webkit-slider-thumb {
      -webkit-appearance: none;
      height: 0.9rem;
      width: 0.9rem;
      border-radius: var(--radius-round);
      background: var(--neutral-90);
      margin-top: 0;
      box-shadow: 0 0 0 1px var(--neutral-00), 0 0 0 4px rgb(var(--rgb-white) / 0.04);
      opacity: 1;
    }
  }

  .time-window-inputs {
    gap: var(--gap-8);

    .control-field {
      flex: 1 1 0;
    }

    input[readonly] {
      color: var(--neutral-50);
      cursor: default;
    }
  }
</style>
