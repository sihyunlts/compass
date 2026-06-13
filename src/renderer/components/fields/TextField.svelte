<svelte:options runes={true} />

<script lang="ts">
  let {
    id,
    value,
    label,
    ariaLabel,
    disabled = false,
    readonly = false,
    onValueChange,
    onKeyDown,
  } = $props<{
    id?: string;
    value: string;
    label?: string;
    ariaLabel?: string;
    disabled?: boolean;
    readonly?: boolean;
    onValueChange?: (value: string) => void;
    onKeyDown?: (event: KeyboardEvent) => void;
  }>();

  const inputLabel = $derived(ariaLabel ?? label);

  const handleInput = (event: Event): void => {
    const input = event.currentTarget;
    if (input instanceof HTMLInputElement) {
      onValueChange?.(input.value);
    }
  };
</script>

<label class="text-field">
  {#if label}
    <span class="text-field-label">{label}</span>
  {/if}
  <input
    {id}
    type="text"
    {value}
    aria-label={inputLabel}
    {disabled}
    {readonly}
    oninput={handleInput}
    onkeydown={onKeyDown}
  />
</label>

<style lang="scss">
  .text-field {
    display: grid;
    gap: var(--gap-6);
    min-width: 0;
    color: var(--neutral-50);
    font-size: var(--text-12);

    input {
      width: 100%;
      box-sizing: border-box;
      color: var(--neutral-90);
      padding: var(--gap-6) var(--gap-8);
      font-size: var(--text-13);
    }
  }

  .text-field-label {
    color: var(--neutral-50);
  }
</style>
