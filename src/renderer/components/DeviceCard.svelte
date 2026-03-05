<svelte:options runes={true} />

<script lang="ts">
  /**
   * Renders one generator/modulator device card and its parameter controls.
   * Maps device kind/state to control widgets and modulation-target options.
   */
  import type { GeneratorDeviceNode } from '../../shared/types';
  import { normalizeOptionalId } from '../../shared/normalize-id';
  import {
    getModulationTargetParamDefinitions,
    isModulationTargetDeviceKind,
  } from '../../shared/device-registry';
  import { getBrowserDeviceLabel } from '../services/devices';
  import AnglePicker from './AnglePicker.svelte';
  import CenterPointPicker from './CenterPointPicker.svelte';
  import CurveEditor from './CurveEditor.svelte';
  import MaskTilePicker from './MaskTilePicker.svelte';

  const BLACK_RGB = '0 0 0';
  const createPaletteGridOrder = (
    start: number,
    end: number,
  ): ReadonlyArray<number> => {
    const rowCount = 8;
    const bandColumnCount = 4;
    const bandSize = rowCount * bandColumnCount;
    const gridColumnCount = 8;
    const valueCount = end - start + 1;
    const topDownOrdered = new Array<number>(valueCount);

    for (let index = 0; index < valueCount; index += 1) {
      const bandIndex = Math.floor(index / bandSize);
      const indexWithinBand = index % bandSize;
      const rowFromBottom = Math.floor(indexWithinBand / bandColumnCount);
      const columnWithinBand = indexWithinBand % bandColumnCount;
      const rowFromTop = (rowCount - 1) - rowFromBottom;
      const column = (bandIndex * bandColumnCount) + columnWithinBand;
      const visualIndex = (rowFromTop * gridColumnCount) + column;
      topDownOrdered[visualIndex] = start + index;
    }

    return Object.freeze(topDownOrdered);
  };

  const PALETTE_GRID_1 = createPaletteGridOrder(0, 63);
  const PALETTE_GRID_2 = createPaletteGridOrder(64, 127);

  let {
    device,
    devices = [] as GeneratorDeviceNode[],
    paletteRevision,
    currentBeat = 0,
    modulationReadoutById = {},
    resolvePaletteRgb,
    isCollapsed = false,
    isDisabledByGroup = false,
    isSelected = false,
    isDragging = false,
    onHeaderPointerDown,
    onHeaderClick,
    onHeaderContextMenu,
    onHeaderDoubleClick,
  } = $props<{
    device: GeneratorDeviceNode;
    devices?: GeneratorDeviceNode[];
    paletteRevision: number;
    currentBeat?: number;
    modulationReadoutById?: Record<string, string>;
    resolvePaletteRgb: (velocity: number) => string;
    isCollapsed?: boolean;
    isDisabledByGroup?: boolean;
    isSelected?: boolean;
    isDragging?: boolean;
    onHeaderPointerDown?: (event: PointerEvent) => void;
    onHeaderClick?: (event: MouseEvent) => void;
    onHeaderContextMenu?: (event: MouseEvent) => void;
    onHeaderDoubleClick?: (event: MouseEvent) => void;
  }>();
  let selectedColorSlotIndex = $state(0);
  let colorPaletteFrameHeight = $state(0);

  $effect(() => {
    if (device.kind !== 'color') {
      selectedColorSlotIndex = 0;
      return;
    }

    const slotCount = Math.max(device.params.velocities.length, 1);
    if (selectedColorSlotIndex >= slotCount) {
      selectedColorSlotIndex = slotCount - 1;
    }
    if (selectedColorSlotIndex < 0) {
      selectedColorSlotIndex = 0;
    }
  });

  const isDeviceDisabled = $derived.by(() => !device.enabled || isDisabledByGroup);
  const deviceLabel = $derived(getBrowserDeviceLabel(device.kind));
  const targetableDevices = $derived.by((): GeneratorDeviceNode[] =>
    devices.filter((item: GeneratorDeviceNode) =>
      item.id !== device.id && isModulationTargetDeviceKind(item.kind)));
  const selectedTargetDevice = $derived.by(() => {
    if (device.kind !== 'modulator' || !device.params.target) {
      return null;
    }
    return targetableDevices.find(
      (item: GeneratorDeviceNode) => item.id === device.params.target?.deviceId,
    ) ?? null;
  });
  const targetParamOptions = $derived.by(() => {
    if (!selectedTargetDevice) {
      return [];
    }
    return getModulationTargetParamDefinitions(selectedTargetDevice.kind);
  });
  const modulationReadoutText = $derived.by(() => {
    if (device.kind !== 'modulator') {
      return '';
    }
    return modulationReadoutById[device.id] ?? 'No active modulation value';
  });

  const maskGroupOptions = $derived.by(() => {
    const groups: string[] = [];
    for (const item of devices) {
      const groupId = normalizeOptionalId(item.groupId);
      if (!groupId || groups.includes(groupId)) {
        continue;
      }
      groups.push(groupId);
    }
    return groups;
  });

  const maskGeneratorOptions = $derived.by(() =>
    devices.filter((item: GeneratorDeviceNode) =>
      item.kind === 'waterdrop' || item.kind === 'scanner' || item.kind === 'spiral'));

  const resolvePaletteSwatchRgb = (velocity: number, revision: number): string => {
    void revision;
    return resolvePaletteRgb(velocity);
  };
  const isPaletteSlotDisabled = (rgb: string): boolean => rgb.trim() === BLACK_RGB;
  const colorPaletteGridSizePx = $derived.by(() => Math.max(0, colorPaletteFrameHeight));
</script>

{#if device.kind === 'waterdrop'}
  <div
    class="device-card instrument"
    class:is-disabled={isDeviceDisabled}
    class:is-collapsed={isCollapsed}
    class:is-selected={isSelected}
    class:is-dragging={isDragging}
    data-device-id={device.id}
    data-device-kind="waterdrop"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header
      class="device-head"
      onpointerdown={onHeaderPointerDown}
      onclick={onHeaderClick}
      oncontextmenu={onHeaderContextMenu}
      ondblclick={onHeaderDoubleClick}
    >
      <div class="device-head-left">
        <input
          class="round-checkbox device-toggle"
          type="checkbox"
          checked={device.enabled}
          data-action="set-device-enabled"
          data-id={device.id}
        />
        <span class="device-title">{deviceLabel}</span>
      </div>
    </header>
    <div class="device-controls">
      <CenterPointPicker
        deviceId={device.id}
        centerX={device.params.centerX}
        centerY={device.params.centerY}
      />
      <div class="column-wrapper">
        <div class="control-field">
            <span class="field-label">Curvature</span>
            <input
              type="number"
              step="0.1"
              value={device.params.curvature}
              data-action="set-waterdrop-param"
              data-id={device.id}
              data-param="curvature"
            />
          </div>
          <div class="control-field">
            <span class="field-label">Start Radius</span>
            <input
              type="number"
              step="0.1"
              value={device.params.startRadius}
              data-action="set-waterdrop-param"
              data-id={device.id}
              data-param="startRadius"
            />
          </div>
        </div>
    </div>
  </div>
{:else if device.kind === 'scanner'}
  <div
    class="device-card instrument"
    class:is-disabled={isDeviceDisabled}
    class:is-collapsed={isCollapsed}
    class:is-selected={isSelected}
    class:is-dragging={isDragging}
    data-device-id={device.id}
    data-device-kind="scanner"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header
      class="device-head"
      onpointerdown={onHeaderPointerDown}
      onclick={onHeaderClick}
      oncontextmenu={onHeaderContextMenu}
      ondblclick={onHeaderDoubleClick}
    >
      <div class="device-head-left">
        <input
          class="round-checkbox device-toggle"
          type="checkbox"
          checked={device.enabled}
          data-action="set-device-enabled"
          data-id={device.id}
        />
        <span class="device-title">{deviceLabel}</span>
      </div>
    </header>
    <div class="device-controls">
      <AnglePicker
        label="Angle (0-360)"
        value={device.params.angleDeg}
        dataAction="set-angle-param"
        dataId={device.id}
        dataParam="angleDeg"
      />
      <div class="control-field">
        <span class="field-label">Start Offset</span>
        <input
          type="number"
          step="0.1"
          value={device.params.startOffset}
          data-action="set-scanner-param"
          data-id={device.id}
          data-param="startOffset"
        />
      </div>
    </div>
  </div>
{:else if device.kind === 'spiral'}
  <div
    class="device-card instrument"
    class:is-disabled={isDeviceDisabled}
    class:is-collapsed={isCollapsed}
    class:is-selected={isSelected}
    class:is-dragging={isDragging}
    data-device-id={device.id}
    data-device-kind="spiral"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header
      class="device-head"
      onpointerdown={onHeaderPointerDown}
      onclick={onHeaderClick}
      oncontextmenu={onHeaderContextMenu}
      ondblclick={onHeaderDoubleClick}
    >
      <div class="device-head-left">
        <input
          class="round-checkbox device-toggle"
          type="checkbox"
          checked={device.enabled}
          data-action="set-device-enabled"
          data-id={device.id}
        />
        <span class="device-title">{deviceLabel}</span>
      </div>
    </header>
    <div class="device-controls">
      <CenterPointPicker
        deviceId={device.id}
        centerX={device.params.centerX}
        centerY={device.params.centerY}
      />
      <div class="column-wrapper">
        <div class="control-field">
            <span class="field-label">Turns</span>
            <input
              type="number"
              step="0.1"
              min="0.25"
              max="8"
              value={device.params.turns}
              data-action="set-spiral-param"
              data-id={device.id}
              data-param="turns"
            />
          </div>
          <div class="control-field">
            <span class="field-label">Start Radius</span>
            <input
              type="number"
              step="0.1"
              value={device.params.startRadius}
              data-action="set-spiral-param"
              data-id={device.id}
              data-param="startRadius"
            />
          </div>
        </div>
    </div>
  </div>
{:else if device.kind === 'modulator'}
  <div
    class="device-card effect"
    class:is-disabled={isDeviceDisabled}
    class:is-collapsed={isCollapsed}
    class:is-selected={isSelected}
    class:is-dragging={isDragging}
    data-device-id={device.id}
    data-device-kind="modulator"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header
      class="device-head"
      onpointerdown={onHeaderPointerDown}
      onclick={onHeaderClick}
      oncontextmenu={onHeaderContextMenu}
      ondblclick={onHeaderDoubleClick}
    >
      <div class="device-head-left">
        <input
          class="round-checkbox device-toggle"
          type="checkbox"
          checked={device.enabled}
          data-action="set-device-enabled"
          data-id={device.id}
        />
        <span class="device-title">{deviceLabel}</span>
      </div>
    </header>
    <div class="device-controls">
      <div class="modulation-control-grid">
        <div class="control-field">
          <span class="field-label">Target Device</span>
          <select data-action="set-modulation-target-device" data-id={device.id}>
            <option value="" selected={!device.params.target?.deviceId}>None</option>
            {#each targetableDevices as targetDevice (targetDevice.id)}
              <option
                value={targetDevice.id}
                selected={device.params.target?.deviceId === targetDevice.id}
              >
                {getBrowserDeviceLabel(targetDevice.kind)} ({targetDevice.id})
              </option>
            {/each}
          </select>
        </div>
        <div class="control-field">
          <span class="field-label">Target Parameter</span>
          <select
            data-action="set-modulation-target-param"
            data-id={device.id}
            disabled={!selectedTargetDevice}
          >
            <option value="" selected={!device.params.target?.paramKey}>None</option>
            {#each targetParamOptions as option (option.key)}
              <option
                value={option.key}
                selected={device.params.target?.paramKey === option.key}
              >
                {option.label}
              </option>
            {/each}
          </select>
        </div>
        <div class="control-field">
          <span class="field-label">Amount</span>
          <input
            type="number"
            step="0.1"
            value={device.params.amount}
            data-action="set-modulation-amount"
            data-id={device.id}
          />
        </div>
        <div class="control-field">
          <span class="field-label">Divisions</span>
          <select data-action="set-modulation-divisions" data-id={device.id}>
            {#each [4, 8, 16, 32, 64] as divisions (divisions)}
              <option value={divisions} selected={device.params.curve.divisions === divisions}>
                {divisions}
              </option>
            {/each}
          </select>
        </div>
      </div>
      <CurveEditor
        deviceId={device.id}
        curve={device.params.curve}
        currentBeat={currentBeat}
      />
      <span class="modulation-readout">{modulationReadoutText}</span>
    </div>
  </div>
{:else if device.kind === 'mirror'}
  <div
    class="device-card effect"
    class:is-disabled={isDeviceDisabled}
    class:is-collapsed={isCollapsed}
    class:is-selected={isSelected}
    class:is-dragging={isDragging}
    data-device-id={device.id}
    data-device-kind="mirror"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header
      class="device-head"
      onpointerdown={onHeaderPointerDown}
      onclick={onHeaderClick}
      oncontextmenu={onHeaderContextMenu}
      ondblclick={onHeaderDoubleClick}
    >
      <div class="device-head-left">
        <input
          class="round-checkbox device-toggle"
          type="checkbox"
          checked={device.enabled}
          data-action="set-device-enabled"
          data-id={device.id}
        />
        <span class="device-title">{deviceLabel}</span>
      </div>
    </header>
    <div class="device-controls">
      <AnglePicker
        label="Mirror Axis Angle (0-360)"
        value={device.params.angleDeg}
        dataAction="set-angle-param"
        dataId={device.id}
        dataParam="angleDeg"
      />
    </div>
  </div>
{:else if device.kind === 'symmetry'}
  <div
    class="device-card effect"
    class:is-disabled={isDeviceDisabled}
    class:is-collapsed={isCollapsed}
    class:is-selected={isSelected}
    class:is-dragging={isDragging}
    data-device-id={device.id}
    data-device-kind="symmetry"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header
      class="device-head"
      onpointerdown={onHeaderPointerDown}
      onclick={onHeaderClick}
      oncontextmenu={onHeaderContextMenu}
      ondblclick={onHeaderDoubleClick}
    >
      <div class="device-head-left">
        <input
          class="round-checkbox device-toggle"
          type="checkbox"
          checked={device.enabled}
          data-action="set-device-enabled"
          data-id={device.id}
        />
        <span class="device-title">{deviceLabel}</span>
      </div>
    </header>
    <div class="device-controls">
      <div class="control-field">
        <span class="field-label">Mode</span>
        <select data-action="set-effect-symmetry-mode" data-id={device.id}>
          <option value="mirror-half" selected={device.params.mode === 'mirror-half'}
            >Half Mirror</option
          >
          <option value="quad-mirror" selected={device.params.mode === 'quad-mirror'}
            >Quad Mirror</option
          >
          <option value="quad-pinwheel" selected={device.params.mode === 'quad-pinwheel'}
            >Quad Pinwheel</option
          >
        </select>
      </div>
      <div class="control-field">
        <span class="field-label">Axis (Half Mode)</span>
        <select data-action="set-effect-symmetry-axis" data-id={device.id}>
          <option value="horizontal" selected={device.params.axis === 'horizontal'}>Horizontal</option>
          <option value="vertical" selected={device.params.axis === 'vertical'}>Vertical</option>
        </select>
      </div>
      <div class="control-field">
        <span class="field-label">Source Quadrant</span>
        <select data-action="set-effect-symmetry-anchor" data-id={device.id}>
          <option value="bl" selected={device.params.sourceAnchor === 'bl'}>Bottom Left</option>
          <option value="br" selected={device.params.sourceAnchor === 'br'}>Bottom Right</option>
          <option value="tr" selected={device.params.sourceAnchor === 'tr'}>Top Right</option>
          <option value="tl" selected={device.params.sourceAnchor === 'tl'}>Top Left</option>
        </select>
      </div>
    </div>
  </div>
{:else if device.kind === 'mask'}
  <div
    class="device-card effect"
    class:is-disabled={isDeviceDisabled}
    class:is-collapsed={isCollapsed}
    class:is-selected={isSelected}
    class:is-dragging={isDragging}
    data-device-id={device.id}
    data-device-kind="mask"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header
      class="device-head"
      onpointerdown={onHeaderPointerDown}
      onclick={onHeaderClick}
      oncontextmenu={onHeaderContextMenu}
      ondblclick={onHeaderDoubleClick}
    >
      <div class="device-head-left">
        <input
          class="round-checkbox device-toggle"
          type="checkbox"
          checked={device.enabled}
          data-action="set-device-enabled"
          data-id={device.id}
        />
        <span class="device-title">{deviceLabel}</span>
      </div>
    </header>
    <div class="device-controls">
      <div class="control-field">
        <span class="field-label">Mode</span>
        <select data-action="set-mask-mode" data-id={device.id}>
          <option value="include" selected={device.params.mode === 'include'}>
            Show Selection Only
          </option>
          <option value="exclude" selected={device.params.mode === 'exclude'}>
            Hide Selection Only
          </option>
        </select>
      </div>
      <div class="control-field">
        <span class="field-label">Mask Source</span>
        <select data-action="set-mask-source-kind" data-id={device.id}>
          <option value="tiles" selected={device.params.sourceKind === 'tiles'}>Tiles</option>
          <option value="group" selected={device.params.sourceKind === 'group'}>Group</option>
          <option value="generator" selected={device.params.sourceKind === 'generator'}>
            Generator
          </option>
        </select>
      </div>
      <div class="control-field">
        <span class="field-label">Source Visibility</span>
        <select data-action="set-mask-source-visibility" data-id={device.id}>
          <option value="hide" selected={device.params.sourceVisibility !== 'show'}>
            Hide
          </option>
          <option value="show" selected={device.params.sourceVisibility === 'show'}>
            Show
          </option>
        </select>
      </div>
      {#if device.params.sourceKind === 'tiles'}
        <MaskTilePicker
          deviceId={device.id}
          tiles={device.params.tiles}
        />
      {:else if device.params.sourceKind === 'group'}
        <div class="control-field">
          <span class="field-label">Group</span>
          <select
            data-action="set-mask-source-id"
            data-id={device.id}
            disabled={maskGroupOptions.length === 0}
          >
            <option value="" selected={!device.params.sourceId}>
              {maskGroupOptions.length === 0 ? 'No Groups' : 'None'}
            </option>
            {#each maskGroupOptions as groupId (groupId)}
              <option value={groupId} selected={device.params.sourceId === groupId}>
                {groupId}
              </option>
            {/each}
          </select>
        </div>
      {:else}
        <div class="control-field">
          <span class="field-label">Generator</span>
          <select
            data-action="set-mask-source-id"
            data-id={device.id}
            disabled={maskGeneratorOptions.length === 0}
          >
            <option value="" selected={!device.params.sourceId}>
              {maskGeneratorOptions.length === 0 ? 'No Generators' : 'None'}
            </option>
            {#each maskGeneratorOptions as generator (generator.id)}
              <option
                value={generator.id}
                selected={device.params.sourceId === generator.id}
              >
                {getBrowserDeviceLabel(generator.kind)} ({generator.id})
              </option>
            {/each}
          </select>
        </div>
      {/if}
    </div>
  </div>
{:else if device.kind === 'color'}
  <div
    class="device-card effect"
    class:is-disabled={isDeviceDisabled}
    class:is-collapsed={isCollapsed}
    class:is-selected={isSelected}
    class:is-dragging={isDragging}
    data-device-id={device.id}
    data-device-kind="color"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header
      class="device-head"
      onpointerdown={onHeaderPointerDown}
      onclick={onHeaderClick}
      oncontextmenu={onHeaderContextMenu}
      ondblclick={onHeaderDoubleClick}
    >
      <div class="device-head-left">
        <input
          class="round-checkbox device-toggle"
          type="checkbox"
          checked={device.enabled}
          data-action="set-device-enabled"
          data-id={device.id}
        />
        <span class="device-title">{deviceLabel}</span>
      </div>
    </header>
    <div class="device-controls">
      <div class="column-wrapper">
        <div
          class="color-palette-container"
          data-action="color-palette"
          data-id={device.id}
          data-slot-index={selectedColorSlotIndex}
          style={`--color-palette-grid-size:${colorPaletteGridSizePx}px;`}
        >
          <div
            class="color-palette-frame"
            bind:clientHeight={colorPaletteFrameHeight}
          >
            <div
              class="color-palette-grid"
            >
              {#each PALETTE_GRID_1 as paletteIndex (paletteIndex)}
                {@const paletteRgb = resolvePaletteSwatchRgb(paletteIndex, paletteRevision)}
                <button
                  type="button"
                  class="color-palette-cell"
                  class:is-selected={device.params.velocities[selectedColorSlotIndex] === paletteIndex}
                  data-action="color-palette-cell"
                  data-palette-index={paletteIndex}
                  disabled={isPaletteSlotDisabled(paletteRgb)}
                  style={`background-color: rgb(${paletteRgb});`}
                  aria-label={`Palette ${paletteIndex}`}
                ></button>
              {/each}
            </div>
          </div>

          <div class="color-palette-frame">
            <div
              class="color-palette-grid"
            >
              {#each PALETTE_GRID_2 as paletteIndex (paletteIndex)}
                {@const paletteRgb = resolvePaletteSwatchRgb(paletteIndex, paletteRevision)}
                <button
                  type="button"
                  class="color-palette-cell"
                  class:is-selected={device.params.velocities[selectedColorSlotIndex] === paletteIndex}
                  data-action="color-palette-cell"
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
  </div>
{:else if device.kind === 'rotate'}
  <div
    class="device-card effect"
    class:is-disabled={isDeviceDisabled}
    class:is-collapsed={isCollapsed}
    class:is-selected={isSelected}
    class:is-dragging={isDragging}
    data-device-id={device.id}
    data-device-kind="rotate"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header
      class="device-head"
      onpointerdown={onHeaderPointerDown}
      onclick={onHeaderClick}
      oncontextmenu={onHeaderContextMenu}
      ondblclick={onHeaderDoubleClick}
    >
      <div class="device-head-left">
        <input
          class="round-checkbox device-toggle"
          type="checkbox"
          checked={device.enabled}
          data-action="set-device-enabled"
          data-id={device.id}
        />
        <span class="device-title">{deviceLabel}</span>
      </div>
    </header>
    <div class="device-controls">
      <AnglePicker
        label="Angle (0-360)"
        value={device.params.angleDeg}
        dataAction="set-angle-param"
        dataId={device.id}
        dataParam="angleDeg"
      />
    </div>
  </div>
{:else}
  <div
    class="device-card effect"
    class:is-disabled={isDeviceDisabled}
    class:is-collapsed={isCollapsed}
    class:is-selected={isSelected}
    class:is-dragging={isDragging}
    data-device-id={device.id}
    data-device-kind="reverse"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header
      class="device-head"
      onpointerdown={onHeaderPointerDown}
      onclick={onHeaderClick}
      oncontextmenu={onHeaderContextMenu}
      ondblclick={onHeaderDoubleClick}
    >
      <div class="device-head-left">
        <input
          class="round-checkbox device-toggle"
          type="checkbox"
          checked={device.enabled}
          data-action="set-device-enabled"
          data-id={device.id}
        />
        <span class="device-title">{deviceLabel}</span>
      </div>
    </header>
    <div class="device-controls">
      <div class="control-field">
        <span class="field-label">Action</span>
        <input type="text" value="Reverse Note Timeline" readonly />
      </div>
    </div>
  </div>
{/if}

<style lang="scss">
  .device-card {
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    border: 1px solid var(--neutral-20);
    border-radius: var(--radius-6);
    background: var(--neutral-10);
    transition: transform 130ms ease, opacity 130ms ease;

    &.is-selected {
      .device-head {
        background-color: rgb(var(--rgb-white) / var(--alpha-04));
      }
    }

    &.instrument {
      box-shadow: inset 0 .125rem 0 0 var(--accent-500);
    }

    &.effect {
      box-shadow: inset 0 .125rem 0 0 var(--effect-500);
    }

    .device-head {
      padding: var(--gap-8) var(--gap-8) var(--gap-4);
      border-bottom: 1px solid var(--neutral-20);
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--gap-10);
      cursor: grab;
      user-select: none;
      -webkit-user-drag: none;

      &-left {
        display: flex;
        align-items: center;
        gap: var(--gap-8);
      }

      .device-title {
        margin: var(--gap-0);
        font-size: var(--text-13);
        min-width: 0;
      }
    }

    &.is-dragging {
      opacity: 0.86;
      z-index: 12;
      will-change: transform;

      .device-head {
        cursor: grabbing;
      }
    }

    &.is-disabled {
      .device-head .device-title,
      .device-controls {
        opacity: 0.45;
      }
    }

    &.is-collapsed {
      width: var(--gap-48);
      min-width: var(--gap-48);

      .device-controls {
        display: none;
      }

      .device-head {
        flex: 1;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--gap-8) var(--gap-6);
        border-bottom: none;
      }

      .device-head-left {
        flex-direction: column;
        align-items: center;
        gap: var(--gap-6);
      }

      .device-title {
        display: inline-block;
        transform: rotate(-90deg);
        transform-origin: center;
        white-space: nowrap;
      }
    }

    .device-controls {
      padding: var(--gap-10);
      display: flex;
      flex-direction: row;
      gap: var(--gap-10);
      flex: 1;
      min-width: 0;
    }

    .column-wrapper {
      display: flex;
      flex-direction: column;
      gap: var(--gap-8);
    }

    &[data-device-kind='modulator'] {
      .device-controls {
        overflow-y: auto;
        overscroll-behavior: contain;
      }

      .modulation-control-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
        gap: var(--gap-8);
        min-width: 0;
      }

      .modulation-control-grid .control-field {
        width: 100%;
        min-width: 0;
        flex-shrink: 0;
      }

      .modulation-control-grid .control-field input,
      .modulation-control-grid .control-field select {
        width: 100%;
      }

      :global(.modulation-curve-control),
      .modulation-readout {
        flex-shrink: 0;
      }
    }

    &[data-device-kind='mask'] {
      .device-controls {
        flex-direction: column;
      }
    }

    &[data-device-kind='color'] {
      .color-slot-row {
        display: flex;
        gap: var(--gap-4);
        margin-top: var(--gap-4);
      }

      .color-slot {
        width: 1.25rem;
        height: 1.25rem;
        border: 1px solid var(--neutral-20);
        border-radius: var(--radius-2);
        padding: 0;

        &.is-selected {
          outline: 2px solid var(--accent-500);
        }
      }

      .color-palette-container {
        display: flex;
        flex: 1 1 auto;
        gap: var(--gap-8);
        width: calc((var(--color-palette-grid-size, 0px) * 2) + var(--gap-12));
      }

      .color-palette-grid {
        display: grid;
        grid-template-columns: repeat(8, minmax(0, 1fr));
        grid-template-rows: repeat(8, minmax(0, 1fr));
        gap: var(--gap-2);
        inline-size: var(--color-palette-grid-size);
        block-size: var(--color-palette-grid-size);
      }

      .color-palette-cell {
        border: 1px solid var(--neutral-20);
        border-radius: var(--radius-2);
        padding: 0;

        &.is-selected {
          outline: 2px solid var(--accent-500);
        }
      }
    }

    .modulation-readout {
      color: var(--neutral-50);
      font-size: var(--text-12);
    }
  }
</style>
