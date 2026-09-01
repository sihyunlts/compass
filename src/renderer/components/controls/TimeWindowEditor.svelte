<svelte:options runes={true} />

<script lang="ts">
  import type { RendererControlChange } from '../../../devices/control-types';
  import type { ModulationStateByParameter } from '../../../shared/contracts/preview/modulation';
  import type { NumericParameterRule } from '../../../devices/numeric-parameters';
  import { clamp } from '../../../shared/math';
  import FieldShell from '../fields/FieldShell.svelte';
  import NumberField from '../fields/NumberField.svelte';
  import { i18n } from '../../i18n.svelte';
  import { buildNumericInputControlChange } from '../../features/rack/control-target';
  import TimelineVisualizer from './TimelineVisualizer.svelte';

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

  let snapDivisions = $state<(typeof SNAP_DIVISION_OPTIONS)[number]>(16);
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
  const displayedPlayhead = $derived.by(() => {
    if (currentProgress01 === undefined || currentProgress01 === null) {
      return null;
    }

    const progress = clamp(Number.isFinite(currentProgress01) ? currentProgress01 : 0, 0, 1);
    return mode === 'trim' && hasValidWindow
      ? visibleStart + (visibleEnd - visibleStart) * progress
      : progress;
  });
  const rangeStep = $derived(1 / snapDivisions);
  const ticks = $derived.by(() => Array.from(
    { length: snapDivisions - 1 },
    (_, offset) => {
      const index = offset + 1;
      const ratio = index / snapDivisions;
      return {
        index,
        ratio,
        isMajor: index % (snapDivisions / 4) === 0,
        isInsideSelectedSpan: hasValidWindow
          && ratio >= visibleStart - 1e-9
          && ratio <= visibleEnd + 1e-9,
        isOnSelectedBoundary: hasValidWindow
          && (
            Math.abs(ratio - visibleStart) <= 1e-9
            || Math.abs(ratio - visibleEnd) <= 1e-9
          ),
      };
    },
  ));

  const emitControlChange = (
    event: Event,
    paramKey: 'start' | 'end',
    finalize: boolean,
  ): void => {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const value = Number(input.value);
    if (!Number.isFinite(value)) {
      return;
    }

    input.value = String(paramKey === 'start'
      ? clamp(value, resolvedMin, Math.max(resolvedMin, clampedEnd - rangeStep))
      : clamp(value, Math.min(resolvedMax, clampedStart + rangeStep), resolvedMax));
    const change = buildNumericInputControlChange(event, {
      action: dataAction,
      deviceId,
      paramKey,
      finalize,
      step: rangeStep,
    });
    if (change) {
      onControlChange(change);
    }
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
        onclick={() => snapDivisions = divisions}
      >
        {divisions}
      </button>
    {/each}
  </div>

  <div
    class="time-window-surface"
    class:is-invalid={!hasValidWindow}
    style={`--window-start:${visibleStart * 100}%;--window-end:${visibleEnd * 100}%;`}
  >
    <TimelineVisualizer playheadProgress01={displayedPlayhead}>
      <div class="time-window-selected-span"></div>
      {#each ticks as tick (tick.index)}
        <span
          class="time-window-tick"
          class:is-major={tick.isMajor}
          class:is-inside-selected-span={tick.isInsideSelectedSpan}
          class:is-on-selected-boundary={tick.isOnSelectedBoundary}
          style={`left:${tick.ratio * 100}%;`}
        ></span>
      {/each}
    </TimelineVisualizer>

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

      &.selected {
        background: var(--time-window-accent);
        color: var(--color-text-inverse);
      }
    }
  }

  .time-window-surface {
    position: relative;

    &.is-invalid {
      .time-window-selected-span {
        opacity: 0;
      }
    }
  }

  .time-window-selected-span,
  .time-window-tick {
    position: absolute;
  }

  .time-window-selected-span {
    box-sizing: border-box;
    top: 0;
    bottom: 0;
    left: var(--window-start, 0%);
    width: calc(var(--window-end, 0%) - var(--window-start, 0%));
    border: 1px solid var(--time-window-accent);
    border-radius: var(--radius-4);
    background: color-mix(in srgb, var(--time-window-accent) 32%, transparent);
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

    &.is-inside-selected-span {
      top: 1px;
      bottom: 1px;
    }

    &.is-on-selected-boundary {
      display: none;
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
    pointer-events: none;
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
      pointer-events: auto;
      cursor: grab;
    }

    &:active::-webkit-slider-thumb {
      cursor: grabbing;
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
