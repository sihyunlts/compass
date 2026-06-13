<svelte:options runes={true} />

<script lang="ts">
  import type { RendererControlChange } from '../../../devices/control-types';
  import { clamp } from '../../../shared/math';
  import FieldShell from '../fields/FieldShell.svelte';
  import NumberField from '../fields/NumberField.svelte';

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
    onControlChange,
  } = $props<{
    deviceId: string;
    dataAction: string;
    start: number;
    end: number;
    mode: TimeWindowEditorMode;
    modeBadgeText?: string | null;
    currentProgress01?: number;
    onControlChange: (change: RendererControlChange) => void;
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
  const displayedPlayhead = $derived(
    mode === 'trim' && hasValidWindow
      ? visibleStart + (visibleEnd - visibleStart) * normalizedPlayhead
      : normalizedPlayhead,
  );
  const showsPlayhead = $derived(currentProgress01 !== undefined && currentProgress01 !== null);
  const rangeStep = $derived(1 / snapDivisions);
  const ticks = $derived.by(() =>
    Array.from({ length: snapDivisions + 1 }, (_, index) => ({
      index,
      ratio: index / snapDivisions,
      isMajor: index === 0 || index === snapDivisions || index % Math.max(1, snapDivisions / 4) === 0,
    })).filter((tick) => tick.index > 0 && tick.index < snapDivisions));

  const setSnapDivisions = (nextDivisions: number): void => {
    snapDivisions = nextDivisions;
  };

  const emitControlChange = (event: Event, paramKey: string, finalize: boolean): void => {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    onControlChange({
      action: dataAction,
      deviceId,
      paramKey,
      value: input.value,
      finalize,
      step: rangeStep,
    });
  };
</script>

<div class="time-window-editor">
  <div class="time-window-toolbar">
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
    style={`--window-start:${visibleStart * 100}%;--window-end:${visibleEnd * 100}%;--playhead:${displayedPlayhead * 100}%;`}
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
        aria-label="Window start"
        oninput={(event) => emitControlChange(event, 'start', false)}
        onchange={(event) => emitControlChange(event, 'start', true)}
      />
      <input
        class="time-window-range time-window-range-end"
        type="range"
        min="0"
        max="1"
        step={rangeStep}
        value={clampedEnd}
        aria-label="Window end"
        oninput={(event) => emitControlChange(event, 'end', false)}
        onchange={(event) => emitControlChange(event, 'end', true)}
      />
    </div>
  </div>

  <div class="time-window-inputs">
    <NumberField
      label="Start"
      min="0"
      max="1"
      step="0.001"
      value={resolvedStart}
      dataAction={dataAction}
      dataId={deviceId}
      dataParam="start"
      {onControlChange}
    />
    <NumberField
      label="End"
      min="0"
      max="1"
      step="0.001"
      value={resolvedEnd}
      dataAction={dataAction}
      dataId={deviceId}
      dataParam="end"
      {onControlChange}
    />
    <FieldShell label="Length">
      <input type="text" value={windowLengthText} readonly tabindex="-1" />
    </FieldShell>
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

  .time-window-badge {
    display: inline-flex;
    align-items: center;
    height: 1.5rem;
    padding: 0 var(--gap-8);
    border-radius: var(--radius-round);
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

    &.is-invalid {
      .time-window-selected-span {
        opacity: 0;
      }
    }
  }

  .time-window-track {
    position: relative;
    height: 1.75rem;
    border-radius: var(--radius-4);
    background: var(--neutral-20);
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
      var(--time-window-accent);
    opacity: 0.88;
  }

  .time-window-surface.is-stretch {
    .time-window-selected-span {
      background:
        linear-gradient(180deg, rgb(var(--rgb-white) / 0.1), rgb(var(--rgb-white) / 0.02)),
        var(--time-window-accent);
      outline: 1px solid rgb(var(--rgb-white) / 0.12);
      outline-offset: -1px;
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
  }

  .time-window-playhead {
    top: 0;
    bottom: 0;
    left: var(--playhead, 0%);
    width: 2px;
    background: rgb(var(--rgb-white));
    transform: translateX(-1px);
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
    margin-top: calc(-1 * var(--gap-16));
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
      border: 1px solid var(--neutral-00);
      background: var(--neutral-90);
      margin-top: 0;
      opacity: 1;
    }
  }

  .time-window-inputs {
    gap: var(--gap-8);

    :global(.control-field) {
      flex: 1 1 0;
    }

    :global(input[readonly]) {
      color: var(--neutral-50);
      cursor: default;
    }
  }
</style>
