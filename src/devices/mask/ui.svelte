<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/types';
  import { normalizeOptionalId } from '../../shared/normalize-id';
  import MaskTilePicker from '../../renderer/components/MaskTilePicker.svelte';
  import { getRendererDeviceLabel } from '../metadata';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type MaskDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'mask' }>;
  };

  let {
    device,
    devices = [] as GeneratorDeviceNode[],
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
      item.kind === 'waterdrop' || item.kind === 'scanner' || item.kind === 'spiral'));
</script>

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
            {getRendererDeviceLabel(generator.kind)} ({generator.id})
          </option>
        {/each}
      </select>
    </div>
  {/if}
</div>
