<svelte:options runes={true} />

<script lang="ts">
  import type { RendererControlChange } from '../../../devices/control-types';
  import type { DropdownOption, DropdownValue } from '../primitives/dropdown-types';
  import DropdownSelect from '../primitives/DropdownSelect.svelte';
  import FieldShell from './FieldShell.svelte';

  let {
    label,
    value,
    options,
    dataAction,
    dataId,
    disabled = false,
    class: className = '',
    onControlChange,
  } = $props<{
    label: string;
    value: DropdownValue;
    options: readonly DropdownOption[];
    dataAction: string;
    dataId: string;
    disabled?: boolean;
    class?: string;
    onControlChange: (change: RendererControlChange) => void;
  }>();

  const handleValueChange = (nextValue: DropdownValue): void => {
    onControlChange({
      action: dataAction,
      deviceId: dataId,
      value: nextValue,
      finalize: true,
    });
  };
</script>

<FieldShell {label} class={className}>
  <DropdownSelect
    {value}
    {options}
    ariaLabel={label}
    {disabled}
    onValueChange={handleValueChange}
  />
</FieldShell>
