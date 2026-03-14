<svelte:options runes={true} />

<script lang="ts">
  /** Renders the shared device card shell and mounts the kind-specific editor body. */
  import { tick } from 'svelte';
  import { getRendererDeviceDefinition } from '../../devices';
  import type { GeneratorDeviceNode } from '../../shared/model';

  let {
    device,
    devices = [] as GeneratorDeviceNode[],
    deviceDisplayNameById = {},
    groupDisplayNameById = {},
    paletteRevision,
    currentBeat = 0,
    modulationReadoutById = {},
    resolvePaletteRgb,
    title,
    isCollapsed = false,
    isDisabledByGroup = false,
    isSelected = false,
    isDragging = false,
    isRenaming = false,
    renameValue = '',
    onRenameInput,
    onRenameBlur,
    onRenameKeyDown,
    onHeaderPointerDown,
    onHeaderClick,
    onHeaderContextMenu,
    onHeaderDoubleClick,
  } = $props<{
    device: GeneratorDeviceNode;
    devices?: GeneratorDeviceNode[];
    deviceDisplayNameById?: Record<string, string>;
    groupDisplayNameById?: Record<string, string>;
    paletteRevision: number;
    currentBeat?: number;
    modulationReadoutById?: Record<string, string>;
    resolvePaletteRgb: (velocity: number) => string;
    title: string;
    isCollapsed?: boolean;
    isDisabledByGroup?: boolean;
    isSelected?: boolean;
    isDragging?: boolean;
    isRenaming?: boolean;
    renameValue?: string;
    onRenameInput?: (event: Event) => void;
    onRenameBlur?: (event: FocusEvent) => void;
    onRenameKeyDown?: (event: KeyboardEvent) => void;
    onHeaderPointerDown?: (event: PointerEvent) => void;
    onHeaderClick?: (event: MouseEvent) => void;
    onHeaderContextMenu?: (event: MouseEvent) => void;
    onHeaderDoubleClick?: (event: MouseEvent) => void;
  }>();

  let renameInputEl = $state<HTMLInputElement | null>(null);
  const isDeviceDisabled = $derived(!device.enabled || isDisabledByGroup);
  const isInlineRenaming = $derived(isRenaming && !isCollapsed);
  const deviceDefinition = $derived(getRendererDeviceDefinition(device.kind));
  const deviceCardClass = $derived(
    deviceDefinition.group === 'generator' ? 'device-card instrument' : 'device-card effect',
  );
  const DeviceEditor = $derived(deviceDefinition.editor);

  $effect(() => {
    if (!isInlineRenaming) {
      return;
    }

    void tick().then(() => {
      renameInputEl?.focus();
      renameInputEl?.select();
    });
  });
</script>

<div
  class={deviceCardClass}
  class:is-disabled={isDeviceDisabled}
  class:is-collapsed={isCollapsed}
  class:is-selected={isSelected}
  class:is-dragging={isDragging}
  class:is-renaming={isRenaming}
  data-device-id={device.id}
  data-device-kind={device.kind}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header
    class="device-head"
    onpointerdown={isRenaming ? undefined : onHeaderPointerDown}
    onclick={isRenaming ? undefined : onHeaderClick}
    oncontextmenu={isRenaming ? undefined : onHeaderContextMenu}
    ondblclick={isRenaming ? undefined : onHeaderDoubleClick}
  >
    <div class="device-head-left">
      <input
        class="round-checkbox device-toggle"
        type="checkbox"
        checked={device.enabled}
        data-action="set-device-enabled"
        data-id={device.id}
      />
      {#if isInlineRenaming}
        <input
          bind:this={renameInputEl}
          class="device-title-input"
          type="text"
          value={renameValue}
          data-preserve-rack-selection="true"
          aria-label={`Rename ${title}`}
          oninput={onRenameInput}
          onblur={onRenameBlur}
          onkeydown={onRenameKeyDown}
          onpointerdown={(event) => event.stopPropagation()}
          onclick={(event) => event.stopPropagation()}
          oncontextmenu={(event) => event.stopPropagation()}
        />
      {:else}
        <span class="device-title">{title}</span>
      {/if}
    </div>
  </header>

  <DeviceEditor
    {device}
    {devices}
    {deviceDisplayNameById}
    {groupDisplayNameById}
    {paletteRevision}
    {currentBeat}
    {modulationReadoutById}
    {resolvePaletteRgb}
  />
</div>

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
      gap: var(--gap-10);
      cursor: grab;
      -webkit-user-drag: none;

      &-left {
        display: flex;
        align-items: center;
        gap: var(--gap-8);
      }

      .device-title,
      .device-title-input {
        min-width: 0;
        font-size: var(--text-13);
        line-height: 1.2;
      }

      .device-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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

    &.is-renaming {
      .device-head {
        cursor: default;
      }
    }

    &.is-disabled {
      .device-head .device-title,
      .device-head .device-title-input {
        opacity: 0.45;
      }

      :global(.device-controls) {
        opacity: 0.45;
      }
    }

    &.is-collapsed {
      width: 2.2rem;
      min-width: 2.2rem;

      :global(.device-controls) {
        display: none;
      }

      .device-head {
        flex: 1;
        flex-direction: column;
        align-items: center;
        padding: var(--gap-10) var(--gap-6);
        border-bottom: none;
      }

      .device-head-left {
        flex-direction: column;
        gap: var(--gap-12);
      }

      .device-title {
        writing-mode: vertical-rl;
        transform: rotate(180deg);
      }

      .device-title-input {
        writing-mode: vertical-rl;
        transform: rotate(180deg);
        text-align: center;
      }
    }

    .device-title-input {
      all: unset;
      display: block;
      field-sizing: content;
      max-width: 100%;
      font: inherit;
      font-size: var(--text-13);
      line-height: 1.2;
      color: inherit;
      caret-color: currentColor;
      cursor: text;
    }

    :global(.device-controls) {
      padding: var(--gap-10);
      display: flex;
      gap: var(--gap-10);
      flex: 1;
      min-width: 0;
    }

    :global(.column-wrapper) {
      display: flex;
      flex-direction: column;
      gap: var(--gap-8);
    }

    &[data-device-kind='modulator'] {
      :global(.device-controls) {
        overflow-y: auto;
        overscroll-behavior: contain;
      }

      :global(.modulation-control-grid) {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
        gap: var(--gap-8);
        min-width: 0;
      }

      :global(.modulation-control-grid .control-field) {
        width: 100%;
        min-width: 0;
      }

      :global(.modulation-control-grid .control-field input),
      :global(.modulation-control-grid .control-field select) {
        width: 100%;
      }

      :global(.modulation-curve-control),
      :global(.modulation-readout) {
        flex-shrink: 0;
      }
    }

    &[data-device-kind='mask'] {
      :global(.device-controls) {
        flex-direction: column;
      }
    }

    &[data-device-kind='color'] {
      :global(.color-slot-row) {
        display: flex;
        gap: var(--gap-4);
        margin-top: var(--gap-4);
      }

      :global(.color-slot) {
        width: 1.25rem;
        height: 1.25rem;
        border: 1px solid var(--neutral-20);
        border-radius: var(--radius-2);
        padding: 0;
      }

      :global(.color-slot.is-selected) {
        outline: 2px solid var(--accent-500);
      }

      :global(.color-palette-container) {
        display: flex;
        flex: 1 1 auto;
        gap: var(--gap-8);
        width: calc((var(--color-palette-grid-size, 0px) * 2) + var(--gap-12));
      }

      :global(.color-palette-grid) {
        display: grid;
        grid-template-columns: repeat(8, minmax(0, 1fr));
        grid-template-rows: repeat(8, minmax(0, 1fr));
        gap: var(--gap-2);
        inline-size: var(--color-palette-grid-size);
        block-size: var(--color-palette-grid-size);
      }

      :global(.color-palette-cell) {
        border: 1px solid var(--neutral-20);
        border-radius: var(--radius-2);
        padding: 0;
      }

      :global(.color-palette-cell.is-selected) {
        outline: 2px solid var(--accent-500);
      }
    }

    :global(.modulation-readout) {
      color: var(--neutral-50);
      font-size: var(--text-12);
    }
  }
</style>
