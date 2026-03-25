<svelte:options runes={true} />

<script lang="ts">
  import { clamp } from '../../shared/math';

  const SNAP_DIVISION_OPTIONS = [4, 8, 16, 32] as const;

  let {
    deviceId,
    dataAction,
    start,
    end,
    currentProgress01,
  } = $props<{
    deviceId: string;
    dataAction: string;
    start: number;
    end: number;
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
    <span class="field-label">Window</span>
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
    class:is-invalid={!hasValidWindow}
    style={`--window-start:${visibleStart * 100}%;--window-end:${visibleEnd * 100}%;--playhead:${normalizedPlayhead * 100}%;`}
  >
    <div class="time-window-track" aria-hidden="true">
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
    display: flex;
    flex-direction: column;
    gap: var(--gap-8);
  }

  .time-window-toolbar,
  .time-window-ruler,
  .time-window-inputs {
    display: flex;
    align-items: center;
  }

  .time-window-toolbar {
    justify-content: space-between;
    gap: var(--gap-8);
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
        background: var(--effect-500);
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
      border-color: var(--effect-500);

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

  .time-window-selected-span,
  .time-window-playhead,
  .time-window-tick {
    position: absolute;
  }

  .time-window-selected-span {
    top: 0;
    bottom: 0;
    left: var(--window-start, 0%);
    width: calc(var(--window-end, 0%) - var(--window-start, 0%));
    min-width: 0;
    background:
      linear-gradient(180deg, rgb(var(--rgb-white) / 0.14), rgb(var(--rgb-white) / 0.04)),
      var(--effect-500);
    opacity: 0.88;
  }

  .time-window-playhead {
    top: 0;
    bottom: 0;
    left: var(--playhead, 0%);
    width: 2px;
    background: var(--accent-500);
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
