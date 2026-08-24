<svelte:options runes={true} />

<script lang="ts">
  import type { RendererControlChange } from '../../../devices/control-types';
  import type { ModulationStateByParameter } from '../../../shared/contracts/preview/modulation';
  import type { NumericParameterRule } from '../../../devices/numeric-parameters';
  import { clamp } from '../../../shared/math';
  import FieldShell from '../fields/FieldShell.svelte';
  import NumberField from '../fields/NumberField.svelte';
  import { i18n } from '../../i18n.svelte';

  const SNAP_DIVISION_OPTIONS = [4, 8, 16, 32, 64] as const;
  type TimeWindowEditorMode = 'stretch' | 'trim';

  let {
    deviceId,
    dataAction,
    start,
    end,
    mode,
    parameter,
    currentProgress01,
    modulationStateByParameter = {},
    onControlChange,
  } = $props<{
    deviceId: string;
    dataAction: string;
    start: number;
    end: number;
    mode: TimeWindowEditorMode;
    parameter?: NumericParameterRule;
    currentProgress01?: number;
    modulationStateByParameter?: ModulationStateByParameter;
    onControlChange: (change: RendererControlChange) => void;
  }>();

  let snapDivisions = $state<number>(16);
  const resolvedMin = $derived(parameter?.input.min ?? 0);
  const resolvedMax = $derived(parameter?.input.max ?? 1);

  const resolvedStart = $derived(Number.isFinite(start) ? start : resolvedMin);
  const resolvedEnd = $derived(Number.isFinite(end) ? end : resolvedMin);
  const clampedStart = $derived(clamp(resolvedStart, resolvedMin, resolvedMax));
  const clampedEnd = $derived(clamp(resolvedEnd, resolvedMin, resolvedMax));
  const hasValidWindow = $derived(
    Number.isFinite(start)
    && Number.isFinite(end)
    && start >= resolvedMin
    && end <= resolvedMax
    && end > start,
  );
  const visibleStart = $derived(hasValidWindow ? clampedStart : 0);
  const visibleEnd = $derived(hasValidWindow ? clampedEnd : 0);
  const windowLengthText = $derived(
    hasValidWindow
      ? (visibleEnd - visibleStart).toFixed(3)
      : i18n.t('control.invalid'),
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
  <div
    class="time-window-snap"
    role="group"
    aria-label={i18n.t('control.snapDivisions')}
  >
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

  <div class="time-window-ruler" aria-hidden="true">
    <span>0</span>
    <span>0.5</span>
    <span>1</span>
  </div>

  <div
    class="time-window-surface"
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
        class="time-window-range"
        type="range"
        min={resolvedMin}
        max={resolvedMax}
        step={rangeStep}
        value={clampedStart}
        aria-label={i18n.t('control.windowStart')}
        oninput={(event) => emitControlChange(event, 'start', false)}
        onchange={(event) => emitControlChange(event, 'start', true)}
      />
      <input
        class="time-window-range"
        type="range"
        min={resolvedMin}
        max={resolvedMax}
        step={rangeStep}
        value={clampedEnd}
        aria-label={i18n.t('control.windowEnd')}
        oninput={(event) => emitControlChange(event, 'end', false)}
        onchange={(event) => emitControlChange(event, 'end', true)}
      />
    </div>
  </div>

  <div class="time-window-inputs">
    <NumberField
      label={i18n.t('control.start')}
      {parameter}
      value={resolvedStart}
      dataAction={dataAction}
      dataId={deviceId}
      dataParam="start"
      {modulationStateByParameter}
      {onControlChange}
    />
    <NumberField
      label={i18n.t('control.end')}
      {parameter}
      value={resolvedEnd}
      dataAction={dataAction}
      dataId={deviceId}
      dataParam="end"
      {modulationStateByParameter}
      {onControlChange}
    />
    <FieldShell label={i18n.t('control.length')}>
      <input type="text" value={windowLengthText} readonly tabindex="-1" />
    </FieldShell>
  </div>
</div>

<style lang="scss">
  .time-window-editor {
    --time-window-accent: var(--device-category-accent, var(--color-category-time));
    display: flex;
    flex-direction: column;
    gap: var(--gap-8);
  }

  .time-window-ruler,
  .time-window-inputs {
    display: flex;
    align-items: flex-start;
  }

  .time-window-snap {
    display: flex;
    width: 100%;
    gap: var(--gap-4);
    min-width: 0;

    button {
      flex: 1 1 0;
      border: 0;
      min-width: 0;
      height: 1.5rem;
      border-radius: var(--radius-4);
      background: var(--color-surface-interactive);
      color: var(--color-text-secondary);
      cursor: pointer;

      &.selected {
        background: var(--time-window-accent);
        color: var(--color-text-inverse);
      }
    }
  }

  .time-window-ruler {
    justify-content: space-between;
    color: var(--color-text-secondary);
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
    background: var(--color-surface-interactive);
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
    background: var(--time-window-accent);
    opacity: 0.85;
  }

  .time-window-playhead {
    top: 0;
    bottom: 0;
    left: var(--playhead, 0%);
    width: 2px;
    background: var(--color-surface-inverse);
    transform: translateX(-1px);
  }

  .time-window-tick {
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--color-overlay-highlight-secondary);
    mix-blend-mode: overlay;
    transform: translateX(-0.5px);

    &.is-major {
      background: var(--color-overlay-highlight-primary);
    }
  }

  .time-window-handle-layer {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--gap-2);
    margin-top: calc(-1 * var(--gap-16));
    padding-top: var(--gap-4);
  }

  .time-window-range {
    position: relative;
    z-index: 1;
    width: calc(100% + 0.9rem);
    max-width: none;
    margin-left: -0.45rem;
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
      border: 2px solid var(--color-surface);
      background: var(--color-surface-inverse);
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
      color: var(--color-text-secondary);
      cursor: default;
    }
  }
</style>
