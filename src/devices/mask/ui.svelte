<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import { normalizeOptionalId } from '../../shared/normalize-id';
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
    onControlChange,
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
  const maskGroupSelectOptions = $derived.by(() => [
    {
      value: '',
      label: maskGroupOptions.length === 0 ? 'No Groups' : 'None',
    },
    ...maskGroupOptions.map((groupId) => ({
      value: groupId,
      label: groupDisplayNameById[groupId] ?? groupId,
    })),
  ]);
  const maskGeneratorSelectOptions = $derived.by(() => [
    {
      value: '',
      label: maskGeneratorOptions.length === 0 ? 'No Generators' : 'None',
    },
    ...maskGeneratorOptions.map((generator) => ({
      value: generator.id,
      label: deviceDisplayNameById[generator.id] ?? getRendererDeviceLabel(generator.kind),
    })),
  ]);
</script>

<div class="device-controls">
  <div class="column-wrapper mask-selector-column">
    <SelectField
      label="Mode"
      value={device.params.mode}
      options={MASK_MODE_OPTIONS}
      dataAction="set-mask-mode"
      dataId={device.id}
      {onControlChange}
    />
    <SelectField
      label="Mask Source"
      value={device.params.sourceKind}
      options={MASK_SOURCE_KIND_OPTIONS}
      dataAction="set-mask-source-kind"
      dataId={device.id}
      {onControlChange}
    />
    <SelectField
      label="Source Visibility"
      value={device.params.sourceVisibility}
      options={MASK_SOURCE_VISIBILITY_OPTIONS}
      dataAction="set-mask-source-visibility"
      dataId={device.id}
      {onControlChange}
    />
  </div>
  <div class="column-wrapper mask-source-column">
    {#if device.params.sourceKind === 'tiles'}
      <MaskTilePicker
        deviceId={device.id}
        tiles={device.params.tiles}
      />
    {:else if device.params.sourceKind === 'group'}
      <SelectField
        label="Group"
        value={device.params.sourceId ?? ''}
        options={maskGroupSelectOptions}
        dataAction="set-mask-source-id"
        dataId={device.id}
        disabled={maskGroupOptions.length === 0}
        {onControlChange}
      />
    {:else}
      <SelectField
        label="Generator"
        value={device.params.sourceId ?? ''}
        options={maskGeneratorSelectOptions}
        dataAction="set-mask-source-id"
        dataId={device.id}
        disabled={maskGeneratorOptions.length === 0}
        {onControlChange}
      />
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

    :global(.control-field .dropdown-select),
    :global(.control-field .dropdown-select-trigger) {
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

    :global(.control-field:not(.mask-tile-control) .dropdown-select),
    :global(.control-field:not(.mask-tile-control) .dropdown-select-trigger) {
      width: 100%;
    }
  }
</style>
