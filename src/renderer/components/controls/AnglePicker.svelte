<svelte:options runes={true} />

<script lang="ts">
  import type { RendererControlChange } from '../../../devices/control-types';
  import {
    createModulationParameterKey,
    type ModulationStateByParameter,
  } from '../../../shared/contracts/preview/modulation';
  import {
    formatNumericParameterDisplayValue,
    formatNumericParameterValue,
    type NumericParameterRule,
  } from '../../../devices/numeric-parameters';
  import FieldShell from '../fields/FieldShell.svelte';
  import ModulatableControl from '../fields/ModulatableControl.svelte';
  import ModulationIndicator from '../fields/ModulationIndicator.svelte';
  import { resolveModulationDisplayDomain } from '../fields/modulation-display-domain';
  import { resolveDisplayedModulationStates } from '../../features/preview/modulation-display-selection.svelte';
  import { buildNumericInputControlChange } from '../../features/rack/control-target';

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
    modulationStateByParameter = {},
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
    modulationStateByParameter?: ModulationStateByParameter;
    onControlChange: (change: RendererControlChange) => void;
  }>();

  const resolvedMin = $derived(min ?? parameter?.input.min);
  const resolvedMax = $derived(max ?? parameter?.input.max);
  const resolvedStep = $derived(step ?? parameter?.input.step ?? 1);
  const resolvedUnit = $derived(parameter?.display.unit);
  const dialMin = $derived(resolvedMin ?? 0);
  const dialMax = $derived(resolvedMax ?? 360);
  const valueSpan = $derived(Math.max(dialMax - dialMin, 0));
  const modulationDomain = $derived(resolveModulationDisplayDomain({
    min: dialMin,
    max: dialMax,
    step: resolvedStep,
    circular: true,
  }));
  const modulationParameterKey = $derived(createModulationParameterKey(dataId, dataParam));
  const modulationStates = $derived(
    modulationStateByParameter[modulationParameterKey] ?? [],
  );
  const displayedModulationStates = $derived(
    resolveDisplayedModulationStates(modulationParameterKey, modulationStates),
  );

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
    const change = buildNumericInputControlChange(event, {
      action: dataAction,
      deviceId: dataId,
      paramKey: dataParam,
      finalize,
    });
    if (change) {
      onControlChange(change);
    }
  };
</script>

<FieldShell {label}>
  <ModulatableControl
    class="angle-picker-control"
    states={modulationStates}
    parameterKey={modulationParameterKey}
    modulationContextDeviceId={dataId}
    modulationContextParamKey={dataParam}
    domain={modulationDomain}
    step={resolvedStep}
    display={parameter?.display}
    dragPixelsPerStep={parameter?.input.dragPixelsPerStep}
    amountPanelGapPx={6}
    {onControlChange}
  >
    <div class="angle-picker-controls" data-numeric-input-scope>
      <div
        class="angle-picker-dial"
        data-modulation-floating-anchor
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
        <div class="angle-picker-dial-knob"></div>
        <ModulationIndicator
          states={displayedModulationStates}
          domain={modulationDomain}
        />
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
        data-drag-pixels-per-step={parameter?.input.dragPixelsPerStep}
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
  </ModulatableControl>
</FieldShell>

<style lang="scss">
  .angle-picker-controls {
    --angle-picker-dial-size: calc(var(--gap-32) + var(--gap-8));

    position: relative;
    display: flex;
    align-items: center;
    gap: var(--gap-8);
    min-width: 0;
  }

  :global(.angle-picker-control) {
    width: fit-content;
  }

  .angle-picker-dial {
    position: relative;
    width: var(--angle-picker-dial-size);
    height: var(--angle-picker-dial-size);
    border-radius: var(--radius-round);
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    cursor: n-resize;
    touch-action: none;
    background-color: var(--color-surface-interactive);

    &-knob {
      position: absolute;
      width: var(--gap-8);
      height: var(--gap-8);
      border-radius: var(--radius-round);
      background: var(--device-control-accent, var(--color-surface-inverse));
      transform: rotate(var(--angle-deg)) translateY(calc(-1 * var(--gap-12)));
    }

    &:focus-visible {
      outline: var(--gap-2) solid var(--device-control-accent, var(--color-surface-inverse));
      outline-offset: var(--gap-2);
    }
  }

  .angle-picker-number-input {
    width: var(--field-control-width, 4rem);
    height: 1.75rem;
    flex: 0 0 auto;
  }

  .angle-picker-display-value {
    position: absolute;
    right: 0;
    top: 50%;
    width: var(--field-control-width, 4rem);
    transform: translateY(-50%);
  }
</style>
