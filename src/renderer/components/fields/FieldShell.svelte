<svelte:options runes={true} />

<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    label,
    children,
    class: className = '',
    ...rest
  } = $props<{
    label: string;
    children?: Snippet;
    class?: string;
  } & Record<string, unknown>>();

  const rootClass = $derived(`control-field ${className}`.trim());
</script>

<div {...rest} class={rootClass}>
  <span class="field-label">{label}</span>
  {#if children}
    {@render children()}
  {/if}
</div>

<style lang="scss">
  .control-field {
    display: inline-flex;
    flex-direction: column;
    gap: var(--gap-6);
    min-width: 0;
    min-height: 0;

    > :global(input),
    > :global(select) {
      width: 6.6rem;
      height: 1.75rem;
    }
  }

  .field-label {
    color: var(--neutral-50);
    font-size: var(--text-12);
  }
</style>
