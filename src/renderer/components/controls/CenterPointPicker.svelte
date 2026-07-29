<svelte:options runes={true} />

<script lang="ts">
  import type { RendererControlChange } from '../../../devices/control-types';
  import type { NumericParameterRule } from '../../../devices/numeric-parameters';
  import { clamp } from '../../../shared/math';
  import FieldShell from '../fields/FieldShell.svelte';
  import NumberField from '../fields/NumberField.svelte';

  let {
    deviceId,
    centerX,
    centerY,
    parameter,
    onControlChange,
  } = $props<{
    deviceId: string;
    centerX: number;
    centerY: number;
    parameter?: NumericParameterRule;
    onControlChange: (change: RendererControlChange) => void;
  }>();

  const resolvedMin = $derived(parameter?.input.min ?? 0);
  const resolvedMax = $derived(parameter?.input.max ?? 9);
  const resolvedStep = $derived(parameter?.input.step ?? 0.5);
  const range = $derived(resolvedMax - resolvedMin);
  const midpoint = $derived((resolvedMin + resolvedMax) / 2);

  const resolvedCenterX = $derived(clamp(
    Math.round((centerX - resolvedMin) / resolvedStep) * resolvedStep + resolvedMin,
    resolvedMin,
    resolvedMax,
  ));
  const resolvedCenterY = $derived(clamp(
    Math.round((centerY - resolvedMin) / resolvedStep) * resolvedStep + resolvedMin,
    resolvedMin,
    resolvedMax,
  ));
  const xPercent = $derived(
    (((resolvedCenterX - resolvedMin) / range) * 100).toFixed(3),
  );
  const yPercent = $derived(
    ((1 - (resolvedCenterY - resolvedMin) / range) * 100).toFixed(3),
  );
  const isCenterX = $derived(Math.abs(resolvedCenterX - midpoint) < 0.0001);
  const isCenterY = $derived(Math.abs(resolvedCenterY - midpoint) < 0.0001);
  const gridLineOffsets = $derived.by(() => Array.from(
    { length: Math.max(0, Math.round(range) - 1) },
    (_, index) => (((index + 1) / range) * 100).toFixed(3),
  ));
  let surfaceHeight = $state(0);
</script>

<FieldShell
  label="Center"
  class="center-point-control"
  role="group"
  aria-label="Center point picker"
>
  <div
    class="center-picker-surface"
    bind:clientHeight={surfaceHeight}
    data-center-picker-surface="true"
    data-device-id={deviceId}
    data-min={resolvedMin}
    data-max={resolvedMax}
    data-step={resolvedStep}
    data-center-x-state={isCenterX ? 'center' : 'off-center'}
    data-center-y-state={isCenterY ? 'center' : 'off-center'}
    aria-label="Center point area"
    style={`width:${surfaceHeight}px;--picker-x:${xPercent}%;--picker-y:${yPercent}%;`}
  >
    {#each gridLineOffsets as offset (`x:${offset}`)}
      <span class="center-picker-grid-line is-vertical" style={`left:${offset}%;`}></span>
    {/each}
    {#each gridLineOffsets as offset (`y:${offset}`)}
      <span class="center-picker-grid-line is-horizontal" style={`top:${offset}%;`}></span>
    {/each}
  </div>
  <div class="center-picker-inputs">
    <NumberField
      label="X"
      layout="inline"
      size="compact"
      fill={true}
      {parameter}
      value={resolvedCenterX}
      dataAction="set-center-picker-param"
      dataId={deviceId}
      dataParam="centerX"
      {onControlChange}
    />
    <NumberField
      label="Y"
      layout="inline"
      size="compact"
      fill={true}
      {parameter}
      value={resolvedCenterY}
      dataAction="set-center-picker-param"
      dataId={deviceId}
      dataParam="centerY"
      {onControlChange}
    />
  </div>
</FieldShell>

<style lang="scss">
  .center-picker-surface {
    position: relative;
    flex: 1;
    border: 1px solid var(--color-border-secondary);
    border-radius: var(--radius-4);
    cursor: crosshair;
    --picker-guide-x-color: transparent;
    --picker-guide-y-color: transparent;
    background: var(--color-surface);

    &:active {
      --picker-guide-x-color: var(--color-border-secondary);
      --picker-guide-y-color: var(--color-border-secondary);
    }
    &:active[data-center-x-state='center'] {
      --picker-guide-x-color: var(--device-control-accent, var(--color-surface-inverse));
    }

    &:active[data-center-y-state='center'] {
      --picker-guide-y-color: var(--device-control-accent, var(--color-surface-inverse));
    }

    &::before {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 2;
      background:
        linear-gradient(
          to bottom,
          var(--picker-guide-x-color),
          var(--picker-guide-x-color)
        ) var(--picker-x, 50%) 0 / 1px 100% no-repeat,
        linear-gradient(
          to right,
          var(--picker-guide-y-color),
          var(--picker-guide-y-color)
        ) 0 var(--picker-y, 50%) / 100% 1px no-repeat;
    }

    &::after {
      content: '';
      position: absolute;
      left: var(--picker-x, 50%);
      top: var(--picker-y, 50%);
      width: 0.5rem;
      height: 0.5rem;
      border-radius: var(--radius-round);
      background: var(--device-control-accent, var(--color-surface-inverse));
      transform: translate(-50%, -50%);
      z-index: 3;
    }
  }

  .center-picker-grid-line {
    position: absolute;
    pointer-events: none;
    z-index: 1;
    background: var(--color-surface-interactive);

    &.is-vertical {
      top: 0;
      bottom: 0;
      width: 1px;
    }

    &.is-horizontal {
      left: 0;
      right: 0;
      height: 1px;
    }
  }

  .center-picker-inputs {
    display: flex;
    gap: var(--gap-8);
    margin-top: var(--gap-2);
  }
</style>
