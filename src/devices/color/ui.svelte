<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import type { RendererDeviceEditorPropsBase } from '../types';

  const BLACK_RGB = '0 0 0';

  const createPaletteGridOrder = (
    start: number,
    end: number,
  ): ReadonlyArray<number> => {
    const rowCount = 8;
    const columnGroupWidth = 4;
    const columnGroupSize = rowCount * columnGroupWidth;
    const gridColumnCount = 8;
    const valueCount = end - start + 1;
    const topDownOrdered = new Array<number>(valueCount);

    for (let index = 0; index < valueCount; index += 1) {
      const columnGroupIndex = Math.floor(index / columnGroupSize);
      const indexWithinColumnGroup = index % columnGroupSize;
      const rowFromBottom = Math.floor(indexWithinColumnGroup / columnGroupWidth);
      const columnWithinGroup = indexWithinColumnGroup % columnGroupWidth;
      const rowFromTop = (rowCount - 1) - rowFromBottom;
      const column = (columnGroupIndex * columnGroupWidth) + columnWithinGroup;
      const visualIndex = (rowFromTop * gridColumnCount) + column;
      topDownOrdered[visualIndex] = start + index;
    }

    return Object.freeze(topDownOrdered);
  };

  const PALETTE_GRID_1 = createPaletteGridOrder(0, 63);
  const PALETTE_GRID_2 = createPaletteGridOrder(64, 127);

  type ColorDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'color' }>;
  };

  let {
    device,
    paletteRevision,
    resolvePaletteRgb,
  }: ColorDeviceEditorProps = $props();

  let selectedColorSlotIndex = $state(0);
  let colorPaletteFrameHeight = $state(0);

  $effect(() => {
    const slotCount = Math.max(device.params.velocities.length, 1);
    if (selectedColorSlotIndex >= slotCount) {
      selectedColorSlotIndex = slotCount - 1;
    }
    if (selectedColorSlotIndex < 0) {
      selectedColorSlotIndex = 0;
    }
  });

  const resolvePaletteSwatchRgb = (velocity: number, revision: number): string => {
    void revision;
    return resolvePaletteRgb(velocity);
  };

  const isPaletteSlotDisabled = (rgb: string): boolean => rgb.trim() === BLACK_RGB;
  const colorPaletteGridSizePx = $derived.by(() => Math.max(0, colorPaletteFrameHeight));
</script>

<div class="device-controls">
  <div class="column-wrapper">
    <div
      class="color-palette-container"
      style={`--color-palette-grid-size:${colorPaletteGridSizePx}px;`}
    >
      <div
        class="color-palette-frame"
        bind:clientHeight={colorPaletteFrameHeight}
      >
        <div class="color-palette-grid">
          {#each PALETTE_GRID_1 as paletteIndex (paletteIndex)}
            {@const paletteRgb = resolvePaletteSwatchRgb(paletteIndex, paletteRevision)}
            <button
              type="button"
              class="color-palette-cell"
              class:is-selected={device.params.velocities[selectedColorSlotIndex] === paletteIndex}
              data-action="set-color-slot"
              data-id={device.id}
              data-slot-index={selectedColorSlotIndex}
              data-palette-index={paletteIndex}
              disabled={isPaletteSlotDisabled(paletteRgb)}
              style={`background-color: rgb(${paletteRgb});`}
              aria-label={`Palette ${paletteIndex}`}
            ></button>
          {/each}
        </div>
      </div>

      <div class="color-palette-frame">
        <div class="color-palette-grid">
          {#each PALETTE_GRID_2 as paletteIndex (paletteIndex)}
            {@const paletteRgb = resolvePaletteSwatchRgb(paletteIndex, paletteRevision)}
            <button
              type="button"
              class="color-palette-cell"
              class:is-selected={device.params.velocities[selectedColorSlotIndex] === paletteIndex}
              data-action="set-color-slot"
              data-id={device.id}
              data-slot-index={selectedColorSlotIndex}
              data-palette-index={paletteIndex}
              disabled={isPaletteSlotDisabled(paletteRgb)}
              style={`background-color: rgb(${paletteRgb});`}
              aria-label={`Palette ${paletteIndex}`}
            ></button>
          {/each}
        </div>
      </div>
    </div>

    <div class="color-slot-row">
      {#each device.params.velocities as slotVelocity, slotIndex (slotIndex)}
        <button
          type="button"
          class="color-slot"
          class:is-selected={selectedColorSlotIndex === slotIndex}
          style={`background-color: rgb(${resolvePaletteSwatchRgb(slotVelocity, paletteRevision)});`}
          onclick={() => {
            selectedColorSlotIndex = slotIndex;
          }}
          aria-label={`Color slot ${slotIndex + 1}`}
        ></button>
      {/each}
    </div>
  </div>
  <div class="column-wrapper">
    <div class="control-field">
      <span class="field-label">Note Length</span>
      <input
        type="number"
        step="1"
        min="1"
        value={device.params.noteLengthPercent}
        data-action="set-color-note-length-percent"
        data-id={device.id}
      />
    </div>

    <div class="control-field">
      <span class="field-label">Gap</span>
      <input
        type="number"
        step="1"
        min="0"
        max="400"
        value={device.params.gapPercent}
        data-action="set-color-gap-percent"
        data-id={device.id}
      />
    </div>

    <div class="control-field">
      <span class="field-label">Slots</span>
      <input
        type="number"
        min="1"
        step="1"
        value={device.params.velocities.length}
        data-action="set-color-slot-count"
        data-id={device.id}
        aria-label="Color slot count"
      />
    </div>
  </div>
</div>
