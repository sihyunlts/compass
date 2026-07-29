<svelte:options runes={true} />

<script lang="ts">
  import type { RendererControlChange } from '../../../devices/control-types';
  import {
    formatNumericParameterDisplayValue,
    formatNumericParameterValue,
    type NumericParameterRule,
  } from '../../../devices/numeric-parameters';
  import FieldShell from '../fields/FieldShell.svelte';

  let {
    label,
    value,
    dataAction,
    dataId,
    dataParam,
    parameter,
    min,
    max,
    step,
    onControlChange,
  } = $props<{
    label: string;
    value: number;
    dataAction: string;
    dataId: string;
    dataParam: string;
    parameter?: NumericParameterRule;
    min?: number;
    max?: number;
    step?: number;
    onControlChange: (change: RendererControlChange) => void;
  }>();

  const resolvedMin = $derived(min ?? parameter?.input.min);
  const resolvedMax = $derived(max ?? parameter?.input.max);
  const resolvedStep = $derived(step ?? parameter?.input.step ?? 1);
  const resolvedUnit = $derived(parameter?.display.unit);
  const dialMin = $derived(resolvedMin ?? 0);
  const dialMax = $derived(resolvedMax ?? 360);
  const valueSpan = $derived(Math.max(dialMax - dialMin, 0));

  const numberLabel = $derived(`${label} input`);
  const dialLabel = $derived(`${label} dial`);

  const stepDecimals = $derived.by(() => {
    const stepText = String(resolvedStep);
    const dotIndex = stepText.indexOf('.');
    if (dotIndex < 0) {
      return 0;
    }
    return Math.max(0, stepText.length - dotIndex - 1);
  });

  const dialValue = $derived.by(() => {
    if (valueSpan <= 0) {
      return dialMin;
    }
    let wrapped = (value - dialMin) % valueSpan;
    if (wrapped < 0) {
      wrapped += valueSpan;
    }
    return dialMin + wrapped;
  });
  const ratio = $derived(
    (dialValue - dialMin) / Math.max(valueSpan, 0.000001),
  );
  const dialDeg = $derived(ratio * 360);
  const valueText = $derived(
    stepDecimals > 0 ? value.toFixed(stepDecimals) : String(Math.round(value)),
  );
  const accessibleValueText = $derived(
    parameter
      ? formatNumericParameterDisplayValue(parameter, value, valueText)
      : formatNumericParameterValue(valueText, resolvedUnit),
  );

  const emitControlChange = (event: Event, finalize: boolean): void => {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    onControlChange({
      action: dataAction,
      deviceId: dataId,
      paramKey: dataParam,
      value: input.value,
      finalize,
      step: Number(input.step),
    });
  };
</script>

<FieldShell {label} class="angle-picker">
  <div class="angle-picker-controls" data-numeric-input-scope>
    <div
      class="angle-picker-dial"
      role="slider"
      tabindex="0"
      data-numeric-input-proxy
      data-control-action={dataAction}
      data-device-id={dataId}
      data-param={dataParam}
      aria-label={dialLabel}
      aria-valuemin={resolvedMin}
      aria-valuemax={resolvedMax}
      aria-valuenow={value}
      aria-valuetext={accessibleValueText}
      style={`--angle-deg:${dialDeg.toFixed(3)}deg;`}
    >
      <div class="angle-picker-dial-ring"></div>
      <div class="angle-picker-dial-knob"></div>
    </div>
    <input
      class="angle-picker-number-input"
      class:has-display-unit={resolvedUnit !== undefined}
      type="number"
      min={resolvedMin}
      max={resolvedMax}
      step={resolvedStep}
      value={value}
      data-control-action={dataAction}
      data-device-id={dataId}
      data-param={dataParam}
      data-drag-mode={parameter?.input.dragMode}
      aria-label={numberLabel}
      oninput={(event: Event) => emitControlChange(event, false)}
      onchange={(event: Event) => emitControlChange(event, true)}
    />
    {#if resolvedUnit}
      <span
        class="numeric-value-display angle-picker-display-value"
        aria-hidden="true"
      >
        {accessibleValueText}
      </span>
    {/if}
  </div>
</FieldShell>

<style lang="scss">
  .angle-picker-controls {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--gap-8);
    min-width: 0;
  }

  .angle-picker-dial {
    position: relative;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: var(--radius-round);
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    cursor: n-resize;
    touch-action: none;
    background-color: var(--color-surface-interactive);

    &-ring {
      position: absolute;
      inset: 0;
      border-radius: var(--radius-round);
    }

    &-knob {
      position: absolute;
      width: 0.5rem;
      height: 0.5rem;
      border-radius: var(--radius-round);
      background: var(--device-control-accent, var(--color-surface-inverse));
      transform: rotate(var(--angle-deg)) translateY(-0.75rem);
    }

    &:focus-visible {
      outline: 2px solid var(--device-control-accent, var(--color-surface-inverse));
      outline-offset: 2px;
    }
  }

  .angle-picker-number-input {
    width: 4.8rem;
    height: 1.75rem;
    flex: 0 0 auto;
  }

  .angle-picker-display-value {
    position: absolute;
    right: 0;
    top: 50%;
    width: 4.8rem;
    transform: translateY(-50%);
  }
</style>
