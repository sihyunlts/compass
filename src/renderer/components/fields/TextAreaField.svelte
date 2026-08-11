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
    rows = 5,
    onValueChange,
  } = $props<{
    id?: string;
    value: string;
    label?: string;
    ariaLabel?: string;
    placeholder?: string;
    disabled?: boolean;
    readonly?: boolean;
    maxLength?: number;
    rows?: number;
    onValueChange?: (value: string) => void;
  }>();

  const inputLabel = $derived(ariaLabel ?? label);

  const handleInput = (event: Event): void => {
    const input = event.currentTarget;
    if (input instanceof HTMLTextAreaElement) {
      onValueChange?.(input.value);
    }
  };
</script>

<label class="text-area-field">
  {#if label}
    <span class="text-area-field-label">{label}</span>
  {/if}
  <textarea
    {id}
    {value}
    aria-label={inputLabel}
    {placeholder}
    {disabled}
    {readonly}
    maxlength={maxLength}
    {rows}
    oninput={handleInput}
  ></textarea>
</label>

<style lang="scss">
  .text-area-field {
    display: grid;
    gap: var(--gap-6);
    min-width: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-12);

    textarea {
      width: 100%;
      min-height: 5.5rem;
      max-height: 8rem;
      box-sizing: border-box;
      resize: none;
      border: 0;
      border-radius: var(--radius-4);
      padding: var(--gap-6) var(--gap-8);
      background: var(--color-surface-interactive);
      color: var(--color-text-primary);
      font: inherit;
      font-size: var(--text-13);
      line-height: 1.45;

      &::placeholder {
        color: var(--color-text-tertiary);
        opacity: 1;
      }
    }
  }

  .text-area-field-label {
    color: var(--color-text-secondary);
  }
</style>
