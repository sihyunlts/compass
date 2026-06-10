<svelte:options runes={true} />

<script lang="ts">
  import FieldShell from './FieldShell.svelte';

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
  }>();
</script>

<FieldShell {label} class={className}>
  <input
    type="number"
    {step}
    {min}
    {max}
    {value}
    data-action={dataAction}
    data-id={dataId}
    data-param={dataParam}
    aria-label={ariaLabel}
    {readonly}
    {disabled}
    {tabindex}
  />
</FieldShell>
