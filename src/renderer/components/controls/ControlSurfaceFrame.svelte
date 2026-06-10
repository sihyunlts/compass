<svelte:options runes={true} />

<script lang="ts">
  import type { Snippet } from 'svelte';

  type ControlSurfaceFrameFill = 'square' | 'stretch';

  let {
    fill = 'square',
    minSize = '0',
    children,
    class: className = '',
  } = $props<{
    fill?: ControlSurfaceFrameFill;
    minSize?: string;
    children?: Snippet;
    class?: string;
  }>();

  let measuredHeight = $state(0);
  const rootClass = $derived(`control-surface-frame ${className}`.trim());
  const rootStyle = $derived(
    `--control-surface-min-size:${minSize};--control-surface-size:${Math.max(0, measuredHeight)}px;`,
  );
</script>

<div
  class={rootClass}
  bind:clientHeight={measuredHeight}
  style={rootStyle}
  data-fill={fill}
>
  {#if children}
    {@render children()}
  {/if}
</div>

<style lang="scss">
  .control-surface-frame {
    display: flex;
    align-items: flex-start;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    max-height: 100%;

    &[data-fill='square'] {
      align-items: flex-start;
      justify-content: flex-start;
      flex-basis: 0;
      inline-size: var(--control-surface-size);
      min-width: 0;
      min-height: var(--control-surface-min-size);
      overflow: hidden;

      > :global(*) {
        flex: 0 0 auto;
        inline-size: var(--control-surface-size);
        block-size: var(--control-surface-size);
        min-height: var(--control-surface-min-size);
      }
    }

    &[data-fill='stretch'] {
      align-items: stretch;
      overflow: hidden;

      > :global(*) {
        flex: 1 1 auto;
        width: 100%;
        height: 100%;
        min-height: 0;
      }
    }
  }
</style>
