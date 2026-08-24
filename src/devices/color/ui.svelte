<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import NumberField from '../../renderer/components/fields/NumberField.svelte';
  import { resolveLedSurfaceRgb } from '../../renderer/app/led-surface-color';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { COLOR_NUMERIC_PARAMETERS, MAX_COLOR_SLOT_COUNT } from './schema';
  import { i18n } from '../../renderer/i18n.svelte';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';
  import DeviceControlColumn from '../../renderer/components/rack/DeviceControlColumn.svelte';

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
    modulationStateByParameter,
    onControlChange,
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
    return resolveLedSurfaceRgb(resolvePaletteRgb(velocity));
  };

  const isPaletteSlotDisabled = (rgb: string): boolean => rgb.trim() === BLACK_RGB;
  const colorPaletteGridSizePx = $derived(Math.max(0, colorPaletteFrameHeight));

  const selectPaletteSlot = (paletteIndex: number): void => {
    onControlChange({
      action: 'set-color-slot',
      deviceId: device.id,
      paramKey: String(selectedColorSlotIndex),
      value: paletteIndex,
      finalize: true,
    });
  };
</script>

<DeviceBodyLayout kind="content">
  <DeviceControlColumn>
    <NumberField
      label={i18n.t('control.noteLength')}
      parameter={COLOR_NUMERIC_PARAMETERS.noteLengthPercent}
      value={device.params.noteLengthPercent}
      dataAction="set-color-note-length-percent"
      dataId={device.id}
      dataParam="noteLengthPercent"
      {modulationStateByParameter}
      {onControlChange}
    />

    <NumberField
      label={i18n.t('control.gap')}
      parameter={COLOR_NUMERIC_PARAMETERS.gapPercent}
      value={device.params.gapPercent}
      dataAction="set-color-gap-percent"
      dataId={device.id}
      dataParam="gapPercent"
      {modulationStateByParameter}
      {onControlChange}
    />

    <NumberField
      label={i18n.t('control.colors')}
      min="1"
      max={String(MAX_COLOR_SLOT_COUNT)}
      step="1"
      value={device.params.velocities.length}
      dataAction="set-color-slot-count"
      dataId={device.id}
      ariaLabel={i18n.t('control.colors')}
      {onControlChange}
    />
  </DeviceControlColumn>
  <div
    class="color-palette-column"
    style={`--color-palette-grid-size:${colorPaletteGridSizePx}px;`}
  >
    <div class="color-palette-container">
      <div
        class="color-palette-grid color-palette-grid-measure"
        bind:clientHeight={colorPaletteFrameHeight}
      >
        {#each PALETTE_GRID_1 as paletteIndex (paletteIndex)}
          {@const paletteRgb = resolvePaletteSwatchRgb(paletteIndex, paletteRevision)}
          <button
            type="button"
            class="color-palette-cell"
            class:is-selected={device.params.velocities[selectedColorSlotIndex] === paletteIndex}
            disabled={isPaletteSlotDisabled(paletteRgb)}
            style={`background-color: rgb(${paletteRgb});`}
            aria-label={`Palette ${paletteIndex}`}
            onclick={() => selectPaletteSlot(paletteIndex)}
          ></button>
        {/each}
      </div>

      <div class="color-palette-grid">
        {#each PALETTE_GRID_2 as paletteIndex (paletteIndex)}
          {@const paletteRgb = resolvePaletteSwatchRgb(paletteIndex, paletteRevision)}
          <button
            type="button"
            class="color-palette-cell"
            class:is-selected={device.params.velocities[selectedColorSlotIndex] === paletteIndex}
            disabled={isPaletteSlotDisabled(paletteRgb)}
            style={`background-color: rgb(${paletteRgb});`}
            aria-label={`Palette ${paletteIndex}`}
            onclick={() => selectPaletteSlot(paletteIndex)}
          ></button>
        {/each}
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
</DeviceBodyLayout>

<style lang="scss">
  .color-palette-column {
    display: flex;
    flex-direction: column;
    gap: var(--gap-8);
    inline-size: calc((var(--color-palette-grid-size, 0px) * 2) + var(--gap-12));
    min-inline-size: 0;
    min-height: 0;
  }

  .color-slot-row {
    display: flex;
    gap: var(--gap-4);
    inline-size: 100%;
    margin-top: var(--gap-4);
    min-inline-size: 0;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-inline: contain;
  }

  .color-slot {
    flex: 0 0 1.25rem;
    width: 1.25rem;
    height: 1.25rem;
    border: 1px solid var(--color-surface);
    border-radius: var(--radius-2);
    padding: 0;

    &.is-selected {
      outline: 2px solid var(--color-focus-ring);
      outline-offset: -2px;
    }
  }

  .color-palette-container {
    display: flex;
    flex: 1 1 auto;
    gap: var(--gap-8);
    width: 100%;
  }

  .color-palette-grid {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    grid-template-rows: repeat(8, minmax(0, 1fr));
    gap: var(--gap-2);
    inline-size: var(--color-palette-grid-size);
    block-size: var(--color-palette-grid-size);
  }

  .color-palette-grid-measure {
    block-size: auto;
  }

  .color-palette-cell {
    border: 1px solid var(--color-surface);
    border-radius: var(--radius-2);
    padding: 0;

    &:disabled {
      visibility: hidden;
    }

    &.is-selected {
      outline: 2px solid var(--color-focus-ring);
    }
  }
</style>
