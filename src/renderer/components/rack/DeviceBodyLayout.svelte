<svelte:options runes={true} />

<script lang="ts">
  import type { Snippet } from 'svelte';

  type DeviceBodyLayoutKind = 'content' | 'fields' | 'surface' | 'graph';
  type DeviceBodySize = 'compact' | 'regular' | 'wide';

  type DeviceBodyLayoutProps = {
    size?: DeviceBodySize;
    controlWidth?: string;
  } & ({
    kind: 'surface';
    surface: Snippet;
    settings: Snippet;
    children?: never;
  } | {
    kind: Exclude<DeviceBodyLayoutKind, 'surface'>;
    children: Snippet;
    surface?: never;
    settings?: never;
  });

  const props: DeviceBodyLayoutProps = $props();
  const size = $derived(props.size ?? 'compact');
  const controlWidthStyle = $derived(
    props.controlWidth ? `--device-control-width:${props.controlWidth};` : '',
  );
</script>

<div
  class="device-controls device-body-layout"
  data-layout={props.kind}
  data-size={size}
  style={controlWidthStyle}
>
  {#if props.kind === 'surface'}
    <div class="device-surface-region">
      {@render props.surface()}
    </div>
    <div class="device-settings-region">
      {@render props.settings()}
    </div>
  {:else}
    {@render props.children()}
  {/if}
</div>

<style lang="scss">
  .device-body-layout {
    --device-layout-gap: var(--gap-10);
    --device-body-padding: var(--gap-10);
    --device-control-width: 4rem;
    --device-graph-column-width: 8.5rem;
    --device-graph-content-width: calc(
      var(--device-graph-column-width)
      + var(--device-graph-column-width)
      + var(--device-layout-gap)
    );

    display: flex;
    flex: 1 1 auto;
    align-items: stretch;
    gap: var(--device-layout-gap);
    min-width: 0;
    min-height: 0;
    padding: var(--device-body-padding);

    &[data-layout='content'],
    &[data-layout='fields'] {
      --field-control-width: var(--device-control-width);
    }

    &[data-layout='fields'] {
      align-items: flex-start;
    }

    &[data-layout='surface'] {
      display: grid;
      grid-template-columns: max-content var(--device-control-width);
      align-self: flex-start;
      inline-size: max-content;
    }

    &[data-layout='graph'] {
      inline-size: calc(
        var(--device-graph-content-width)
        + var(--device-body-padding)
        + var(--device-body-padding)
      );

      > :global(*) {
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
      }
    }

    &[data-size='wide'] {
      --device-control-width: 8.5rem;
    }

    &[data-size='regular'] {
      --device-control-width: 5rem;
    }
  }

  .device-surface-region {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;

    > :global(*) {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
    }
  }

  .device-settings-region {
    --field-control-width: 100%;

    display: flex;
    flex: 0 0 var(--device-control-width);
    flex-direction: column;
    gap: var(--gap-8);
    min-width: var(--device-control-width);
    min-height: 0;
  }
</style>
