<svelte:options runes={true} />

<script lang="ts">
  import type { Snippet } from 'svelte';

  export type FieldShellLayout = 'stacked' | 'inline';
  export type FieldShellSize = 'default' | 'compact';
  export type FieldShellLabelVisibility = 'visible' | 'hidden';

  let {
    label,
    children,
    layout = 'stacked',
    size = 'default',
    labelVisibility = 'visible',
    fill = false,
    class: className = '',
    ...rest
  } = $props<{
    label: string;
    children?: Snippet;
    layout?: FieldShellLayout;
    size?: FieldShellSize;
    labelVisibility?: FieldShellLabelVisibility;
    fill?: boolean;
    class?: string;
  } & Record<string, unknown>>();

  const rootClass = $derived(`control-field ${className}`.trim());
</script>

<div
  {...rest}
  class={rootClass}
  class:is-inline={layout === 'inline'}
  class:is-compact={size === 'compact'}
  class:is-fill={fill}
>
  {#if labelVisibility === 'visible'}
    <span class="field-label control-field-label">{label}</span>
  {/if}
  {#if children}
    {@render children()}
  {/if}
</div>

<style lang="scss">
  .control-field {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    gap: var(--gap-6);
    min-width: 0;
    min-height: 0;

    &.is-inline {
      flex-direction: row;
      align-items: center;
      gap: var(--gap-4);
    }

    &.is-fill {
      flex: 1 1 0;
      width: 100%;
    }

    > :global(input),
    > :global(.field-control),
    > :global(.dropdown-select),
    > :global(.dropdown-select .dropdown-select-trigger) {
      width: var(--field-control-width, 4rem);
      height: 1.75rem;
    }

    &.is-fill > :global(input),
    &.is-fill > :global(.field-control),
    &.is-fill > :global(.dropdown-select),
    &.is-fill > :global(.dropdown-select .dropdown-select-trigger) {
      width: 100%;
    }

    &.is-inline.is-fill > :global(input),
    &.is-inline.is-fill > :global(.field-control),
    &.is-inline.is-fill > :global(.dropdown-select),
    &.is-inline.is-fill > :global(.dropdown-select .dropdown-select-trigger) {
      flex: 1 1 0;
    }

    &.is-compact > :global(input) {
      height: var(--gap-20);
      padding: 0 var(--gap-6);
      font-size: var(--text-12);
    }

    &.is-compact > :global(.field-control) {
      height: var(--gap-20);
    }

    &.is-compact > :global(.field-control > input) {
      padding: 0 var(--gap-6);
      font-size: var(--text-12);
    }
  }
</style>
