<svelte:options runes={true} />

<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<div class="device-control-column">
  {@render children()}
</div>

<style lang="scss">
  .device-control-column {
    display: flex;
    flex-direction: column;
    gap: var(--gap-8);
    min-width: 0;
    min-height: 0;
  }
</style>
