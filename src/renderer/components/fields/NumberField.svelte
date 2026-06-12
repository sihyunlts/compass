<svelte:options runes={true} />

<script lang="ts">
  import type { RendererControlChange } from '../../../devices/control-types';
  import FieldShell from '../fields/FieldShell.svelte';

  let {
    label,
    value,
    dataAction,
    dataId,
    dataParam,
    step,
    min,
    max,
    ariaLabel,
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
    step?: number | string;
    min?: number | string;
    max?: number | string;
    ariaLabel?: string;
    readonly?: boolean;
    disabled?: boolean;
    tabindex?: number | string;
    class?: string;
    onControlChange: (change: RendererControlChange) => void;
  }>();

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

<FieldShell {label} class={className}>
  <input
    type="number"
    {step}
    {min}
    {max}
    {value}
    data-control-action={dataAction}
    data-device-id={dataId}
    data-param={dataParam}
    aria-label={ariaLabel}
    {readonly}
    {disabled}
    {tabindex}
    oninput={(event) => emitChange(event, false)}
    onchange={(event) => emitChange(event, true)}
  />
</FieldShell>
