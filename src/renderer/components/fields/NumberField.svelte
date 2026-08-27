<svelte:options runes={true} />

<script lang="ts">
  import type { RendererControlChange } from '../../../devices/control-types';
  import {
    createModulationParameterKey,
    type ModulationParameterState,
    type ModulationStateByParameter,
  } from '../../../shared/contracts/preview/modulation';
  import {
    formatNumericParameterDisplayValue,
    formatNumericParameterValue,
    type NumericParameterRule,
    type NumericParameterUnit,
  } from '../../../devices/numeric-parameters';
  import type {
    FieldShellLabelVisibility,
    FieldShellLayout,
    FieldShellSize,
  } from '../fields/FieldShell.svelte';
  import FieldShell from '../fields/FieldShell.svelte';
  import ModulatableControl from './ModulatableControl.svelte';
  import ModulationIndicator from './ModulationIndicator.svelte';
  import {
    resolveLinearModulationRangeFillRatio,
    resolveModulationDisplayDomain,
  } from './modulation-display-domain';
  import { resolveDisplayedModulationStates } from '../../features/preview/modulation-display-selection.svelte';

  const MODULATION_CORNER_REDUCTION_START = 0.9;
  const MODULATION_MIN_CORNER_SCALE = 0.5;

  let {
    label,
    value,
    dataAction,
    dataId,
    dataParam,
    parameter,
    unit,
    step,
    min,
    max,
    dragPixelsPerStep,
    ariaLabel,
    layout = 'stacked',
    size = 'default',
    labelVisibility = 'visible',
    fill = false,
    modulationStateByParameter = {},
    readonly = false,
    disabled = false,
    tabindex,
    class: className = '',
    onControlChange,
  } = $props<{
    label: string;
    value: number;
    dataAction: string;
    dataId: string;
    dataParam?: string;
    parameter?: NumericParameterRule;
    unit?: NumericParameterUnit;
    step?: number | string;
    min?: number | string;
    max?: number | string;
    dragPixelsPerStep?: number;
    ariaLabel?: string;
    layout?: FieldShellLayout;
    size?: FieldShellSize;
    labelVisibility?: FieldShellLabelVisibility;
    fill?: boolean;
    modulationStateByParameter?: ModulationStateByParameter;
    readonly?: boolean;
    disabled?: boolean;
    tabindex?: number | string;
    class?: string;
    onControlChange: (change: RendererControlChange) => void;
  }>();

  const resolvedStep = $derived(step ?? parameter?.input.step);
  const resolvedMin = $derived(min ?? parameter?.input.min);
  const resolvedMax = $derived(max ?? parameter?.input.max);
  const resolvedDragPixelsPerStep = $derived(
    dragPixelsPerStep ?? parameter?.input.dragPixelsPerStep,
  );
  const resolvedUnit = $derived(unit ?? parameter?.display.unit);
  const resolvedAriaLabel = $derived(ariaLabel ?? label);
  const modulationDomain = $derived(resolveModulationDisplayDomain({
    min: resolvedMin,
    max: resolvedMax,
    step: resolvedStep,
    circular: parameter?.input.dragMode === 'circular',
  }));
  const modulationParameterKey = $derived(
    dataParam ? createModulationParameterKey(dataId, dataParam) : '',
  );
  const modulationStates = $derived(
    modulationParameterKey ? modulationStateByParameter[modulationParameterKey] ?? [] : [],
  );
  const displayedModulationStates = $derived(
    resolveDisplayedModulationStates(modulationParameterKey, modulationStates),
  );
  const modulationRangeFillRatio = $derived(Math.max(
    0,
    ...displayedModulationStates
      .map((state: ModulationParameterState) => resolveLinearModulationRangeFillRatio(
        state.amount,
        modulationDomain,
      )),
  ));
  const modulationCornerScale = $derived(
    modulationRangeFillRatio <= MODULATION_CORNER_REDUCTION_START
      ? 1
      : 1 - Math.min(
          (modulationRangeFillRatio - MODULATION_CORNER_REDUCTION_START)
            / (1 - MODULATION_CORNER_REDUCTION_START),
          1,
        ) * (1 - MODULATION_MIN_CORNER_SCALE),
  );
  const displayValue = $derived.by(() => {
    const valueText = String(value);
    return parameter
      ? formatNumericParameterDisplayValue(parameter, value, valueText)
      : formatNumericParameterValue(valueText, resolvedUnit);
  });

  const emitChange = (event: Event, finalize: boolean): void => {
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

<FieldShell
  {label}
  {layout}
  {size}
  {labelVisibility}
  {fill}
  class={className}
>
  <ModulatableControl
    class="field-control number-field-control"
    states={modulationStates}
    parameterKey={modulationParameterKey}
    modulationContextDeviceId={dataId}
    modulationContextParamKey={dataParam ?? ''}
    domain={modulationDomain}
    cornerScale={modulationCornerScale}
    {onControlChange}
  >
    <input
      class:has-display-unit={resolvedUnit !== undefined}
      type="number"
      step={resolvedStep}
      min={resolvedMin}
      max={resolvedMax}
      value={value}
      data-control-action={dataAction}
      data-device-id={dataId}
      data-param={dataParam}
      data-drag-mode={parameter?.input.dragMode}
      data-drag-pixels-per-step={resolvedDragPixelsPerStep}
      aria-label={resolvedAriaLabel}
      {readonly}
      {disabled}
      {tabindex}
      oninput={(event: Event) => emitChange(event, false)}
      onchange={(event: Event) => emitChange(event, true)}
    />
    {#if resolvedUnit}
      <span
        class="numeric-value-display number-field-display-value"
        class:is-compact={size === 'compact'}
        aria-hidden="true"
      >
        {displayValue}
      </span>
    {/if}
    <ModulationIndicator
      states={displayedModulationStates}
      domain={modulationDomain}
      displayMode="linear"
    />
  </ModulatableControl>
</FieldShell>

<style lang="scss">
  :global(.number-field-control) {
    overflow: hidden;
    border-radius: var(--radius-4);
    border-bottom-right-radius: calc(
      var(--radius-4) * var(--modulation-control-corner-scale)
    );
    border-bottom-left-radius: calc(
      var(--radius-4) * var(--modulation-control-corner-scale)
    );
  }

  :global(.number-field-control > input) {
    width: 100%;
    height: 100%;
    border-bottom-right-radius: inherit;
    border-bottom-left-radius: inherit;
  }

  .number-field-display-value {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 100%;

    &.is-compact {
      height: var(--gap-20);
      padding: 0 var(--gap-6);
      font-size: var(--text-12);
    }
  }

</style>
