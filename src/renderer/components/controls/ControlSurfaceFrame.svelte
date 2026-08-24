<svelte:options runes={true} />

<script lang="ts">
  import type { Snippet } from 'svelte';

  type ControlSurfaceFrameFill = 'square' | 'stretch';

  let {
    fill = 'square',
    children,
  } = $props<{
    fill?: ControlSurfaceFrameFill;
    children: Snippet;
  }>();

  let measuredHeight = $state(0);
  const rootStyle = $derived(
    `--control-surface-size:${Math.max(0, measuredHeight)}px;`,
  );
</script>

<div
  class="control-surface-frame"
  bind:clientHeight={measuredHeight}
  style={rootStyle}
  data-fill={fill}
>
  {@render children()}
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
      justify-content: flex-start;
      flex-basis: 0;
      inline-size: var(--control-surface-size);
      overflow: hidden;

      > :global(*) {
        flex: 0 0 auto;
        inline-size: var(--control-surface-size);
        block-size: var(--control-surface-size);
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
