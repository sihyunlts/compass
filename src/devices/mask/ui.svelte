<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import { normalizeOptionalId } from '../../shared/normalize-id';
  import FieldShell from '../../renderer/components/fields/FieldShell.svelte';
  import MaskTilePicker from '../../renderer/components/controls/MaskTilePicker.svelte';
  import SelectField from '../../renderer/components/fields/SelectField.svelte';
  import {
    getRendererDeviceGroup,
    getRendererDeviceLabel,
  } from '../schema-registry';
  import type { RendererDeviceEditorPropsBase } from '../types';

  const MASK_MODE_OPTIONS = [
    { value: 'include', label: 'Show Selection Only' },
    { value: 'exclude', label: 'Hide Selection Only' },
  ] as const;

  const MASK_SOURCE_KIND_OPTIONS = [
    { value: 'tiles', label: 'Tiles' },
    { value: 'group', label: 'Group' },
    { value: 'generator', label: 'Generator' },
  ] as const;

  const MASK_SOURCE_VISIBILITY_OPTIONS = [
    { value: 'hide', label: 'Hide' },
    { value: 'show', label: 'Show' },
  ] as const;

  type MaskDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'mask' }>;
  };

  let {
    device,
    devices = [] as GeneratorDeviceNode[],
    groupDisplayNameById = {},
    deviceDisplayNameById = {},
  }: MaskDeviceEditorProps = $props();

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
      getRendererDeviceGroup(item.kind) === 'generator'));
</script>

<div class="device-controls">
  <div class="column-wrapper mask-selector-column">
    <SelectField
      label="Mode"
      value={device.params.mode}
      options={MASK_MODE_OPTIONS}
      dataAction="set-mask-mode"
      dataId={device.id}
    />
    <SelectField
      label="Mask Source"
      value={device.params.sourceKind}
      options={MASK_SOURCE_KIND_OPTIONS}
      dataAction="set-mask-source-kind"
      dataId={device.id}
    />
    <SelectField
      label="Source Visibility"
      value={device.params.sourceVisibility}
      options={MASK_SOURCE_VISIBILITY_OPTIONS}
      dataAction="set-mask-source-visibility"
      dataId={device.id}
    />
  </div>
  <div class="column-wrapper mask-source-column">
    {#if device.params.sourceKind === 'tiles'}
      <MaskTilePicker
        deviceId={device.id}
        tiles={device.params.tiles}
      />
    {:else if device.params.sourceKind === 'group'}
      <FieldShell label="Group">
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
              {groupDisplayNameById[groupId] ?? groupId}
            </option>
          {/each}
        </select>
      </FieldShell>
    {:else}
      <FieldShell label="Generator">
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
              {deviceDisplayNameById[generator.id] ?? getRendererDeviceLabel(generator.kind)}
            </option>
          {/each}
        </select>
      </FieldShell>
    {/if}
  </div>
</div>

<style lang="scss">
  .mask-selector-column {
    flex: 0 0 9rem;
    min-width: 0;

    :global(.control-field) {
      width: 100%;
      min-width: 0;
    }

    :global(.control-field select) {
      width: 100%;
    }
  }

  .mask-source-column {
    flex: 0 0 auto;
    align-items: flex-start;
    width: fit-content;
    min-width: 0;
    min-height: 0;
    max-height: 100%;

    :global(.control-field:not(.mask-tile-control)) {
      width: 10rem;
      min-width: 0;
    }

    :global(.control-field:not(.mask-tile-control) select) {
      width: 100%;
    }
  }
</style>
