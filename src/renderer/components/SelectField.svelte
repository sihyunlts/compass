<svelte:options runes={true} />

<script lang="ts">
  import FieldShell from './FieldShell.svelte';

  type SelectFieldValue = string | number;
  type SelectFieldOption = {
    value: SelectFieldValue;
    label: string;
    disabled?: boolean;
  };

  let {
    label,
    value,
    options,
    dataAction,
    dataId,
    disabled = false,
    class: className = '',
  } = $props<{
    label: string;
    value: SelectFieldValue;
    options: readonly SelectFieldOption[];
    dataAction: string;
    dataId: string;
    disabled?: boolean;
    class?: string;
  }>();

  const isSelected = (optionValue: SelectFieldValue): boolean =>
    String(optionValue) === String(value);
</script>

<FieldShell {label} class={className}>
  <select data-action={dataAction} data-id={dataId} {disabled}>
    {#each options as option (option.value)}
      <option
        value={option.value}
        selected={isSelected(option.value)}
        disabled={option.disabled}
      >
        {option.label}
      </option>
    {/each}
  </select>
</FieldShell>
