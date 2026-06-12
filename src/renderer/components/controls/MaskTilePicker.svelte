<svelte:options runes={true} />

<script lang="ts">
  import FieldShell from '../fields/FieldShell.svelte';
  import { hint } from '../overlays/hint';

  const GRID_SIZE = 10;

  let {
    deviceId,
    tiles = [] as number[],
  } = $props<{
    deviceId: string;
    tiles: number[];
  }>();

  const selected = $derived(new Set(tiles));
  const selectionCount = $derived(tiles.length);
  let tileContainerHeight = $state(0);
  const tileGridSize = $derived.by(() =>
    (tileContainerHeight > 0 ? `${tileContainerHeight}px` : '10rem'));

  const cells = $derived.by(() => {
    const next: Array<{ key: string; index: number; x: number; y: number }> = [];
    for (let row = 0; row < GRID_SIZE; row += 1) {
      const y = GRID_SIZE - 1 - row;
      for (let col = 0; col < GRID_SIZE; col += 1) {
        const x = col;
        const index = y * GRID_SIZE + x;
        next.push({ key: `${row}:${col}`, index, x, y });
      }
    }
    return next;
  });
</script>

<FieldShell
  label={`Tile Selected ${selectionCount}`}
  class="mask-tile-control"
  style={`--mask-tile-grid-size:${tileGridSize};`}
>
  <div
    class="mask-tile-container"
    bind:clientHeight={tileContainerHeight}
  >
    <div
      class="mask-tile-grid"
      data-mask-tile-grid="true"
      data-device-id={deviceId}
    >
      {#each cells as cell (cell.key)}
        {@const cellLabel = `X ${cell.x} | Y ${cell.y}`}
        <button
          type="button"
          class="mask-tile"
          class:is-selected={selected.has(cell.index)}
          data-tile-index={cell.index}
          aria-pressed={selected.has(cell.index) ? 'true' : 'false'}
          aria-label={cellLabel}
          use:hint={cellLabel}
        ></button>
      {/each}
    </div>
  </div>
</FieldShell>

<style lang="scss">
  :global(.control-field.mask-tile-control) {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    flex: 1 1 auto;
    align-self: flex-start;
    inline-size: fit-content;
    min-height: 0;
    max-height: 100%;
  }

  :global(.mask-tile-control .field-label) {
    white-space: nowrap;
  }

  .mask-tile-container {
    min-height: 0;
    block-size: 100%;
    inline-size: var(--mask-tile-grid-size, 10rem);
  }

  .mask-tile-grid {
    display: grid;
    grid-template-columns: repeat(10, minmax(0, 1fr));
    grid-template-rows: repeat(10, minmax(0, 1fr));
    inline-size: var(--mask-tile-grid-size, 0px);
    block-size: var(--mask-tile-grid-size, 0px);
    gap: var(--gap-2);
    padding: var(--gap-6);
    border-radius: var(--radius-6);
    border: 1px solid var(--neutral-30);
    user-select: none;
    touch-action: none;
  }

  .mask-tile {
    appearance: none;
    border: none;
    border-radius: var(--radius-2);
    background: var(--neutral-20);
    aspect-ratio: 1 / 1;
    padding: 0;
    cursor: pointer;

    &.is-selected {
      background: var(--device-control-accent, var(--accent-500));
    }
  }
</style>
