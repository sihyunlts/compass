<svelte:options runes={true} />

<script lang="ts">
  import type { RendererControlChange } from '../../../devices/control-types';
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
    ariaLabel,
    layout = 'stacked',
    size = 'default',
    labelVisibility = 'visible',
    fill = false,
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
    ariaLabel?: string;
    layout?: FieldShellLayout;
    size?: FieldShellSize;
    labelVisibility?: FieldShellLabelVisibility;
    fill?: boolean;
    readonly?: boolean;
    disabled?: boolean;
    tabindex?: number | string;
    class?: string;
    onControlChange: (change: RendererControlChange) => void;
  }>();

  const resolvedStep = $derived(step ?? parameter?.input.step);
  const resolvedMin = $derived(min ?? parameter?.input.min);
  const resolvedMax = $derived(max ?? parameter?.input.max);
  const resolvedUnit = $derived(unit ?? parameter?.display.unit);
  const resolvedAriaLabel = $derived(ariaLabel ?? label);
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
</FieldShell>

<style lang="scss">
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
