<svelte:options runes={true} />

<script lang="ts">
  let {
    id,
    value,
    label,
    ariaLabel,
    placeholder,
    disabled = false,
    readonly = false,
    maxLength,
    onValueChange,
    onKeyDown,
  } = $props<{
    id?: string;
    value: string;
    label?: string;
    ariaLabel?: string;
    placeholder?: string;
    disabled?: boolean;
    readonly?: boolean;
    maxLength?: number;
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
    <span>{label}</span>
  {/if}
  <input
    {id}
    type="text"
    {value}
    aria-label={inputLabel}
    {placeholder}
    {disabled}
    {readonly}
    maxlength={maxLength}
    oninput={handleInput}
    onkeydown={onKeyDown}
  />
</label>

<style lang="scss">
  .text-field {
    display: grid;
    gap: var(--gap-6);
    min-width: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-12);

    input {
      width: 100%;
      color: var(--color-text-primary);
      padding: var(--gap-6) var(--gap-8);
      font-size: var(--text-13);

      &::placeholder {
        color: var(--color-text-tertiary);
        opacity: 1;
      }
    }
  }

</style>
