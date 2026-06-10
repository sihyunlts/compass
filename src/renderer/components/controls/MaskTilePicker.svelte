<svelte:options runes={true} />

<script lang="ts">
  import FieldShell from '../fields/FieldShell.svelte';

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

<FieldShell label="Tile Selection">
  <span class="mask-tile-count">Selected {selectionCount}</span>
  <div
    class="mask-tile-grid"
    data-action="mask-tile-grid"
    data-id={deviceId}
  >
    {#each cells as cell (cell.key)}
      <button
        type="button"
        class="mask-tile"
        class:is-selected={selected.has(cell.index)}
        data-tile-index={cell.index}
        aria-pressed={selected.has(cell.index) ? 'true' : 'false'}
        title={`X ${cell.x} | Y ${cell.y}`}
      ></button>
    {/each}
  </div>
</FieldShell>

<style lang="scss">
  .mask-tile-count {
    color: var(--neutral-50);
    font-size: var(--text-12);
  }

  .mask-tile-grid {
    display: grid;
    grid-template-columns: repeat(10, minmax(0, 1fr));
    gap: var(--gap-2);
    padding: var(--gap-6);
    border-radius: var(--radius-6);
    background: var(--neutral-20);
    border: 1px solid var(--neutral-30);
    user-select: none;
    touch-action: none;
  }

  .mask-tile {
    appearance: none;
    border: 1px solid var(--neutral-30);
    border-radius: var(--radius-2);
    background: var(--neutral-10);
    aspect-ratio: 1 / 1;
    padding: 0;
    cursor: pointer;

    &.is-selected {
      background: var(--accent-500);
    }
  }
</style>
