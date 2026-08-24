<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import { normalizeOptionalId } from '../../shared/normalize-id';
  import MaskTilePicker from '../../renderer/components/controls/MaskTilePicker.svelte';
  import SelectField from '../../renderer/components/fields/SelectField.svelte';
  import { getRendererDeviceGroup } from '../schema-registry';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { getDeviceMessageKey } from '../../renderer/device-i18n';
  import { i18n } from '../../renderer/i18n.svelte';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';
  import DeviceControlColumn from '../../renderer/components/rack/DeviceControlColumn.svelte';

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

  const maskModeOptions = $derived([
    { value: 'include', label: i18n.t('option.show') },
    { value: 'exclude', label: i18n.t('option.hide') },
  ]);
  const maskSourceKindOptions = $derived([
    { value: 'tiles', label: i18n.t('option.tiles') },
    { value: 'group', label: i18n.t('control.group') },
    { value: 'generator', label: i18n.t('control.generator') },
  ]);
  const maskSourceVisibilityOptions = $derived([
    { value: 'hide', label: i18n.t('option.hide') },
    { value: 'show', label: i18n.t('option.show') },
  ]);

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
      label: i18n.t('option.none'),
    },
    ...maskGroupOptions.map((groupId) => ({
      value: groupId,
      label: groupDisplayNameById[groupId] ?? groupId,
    })),
  ]);
  const maskGeneratorSelectOptions = $derived.by(() => [
    {
      value: '',
      label: i18n.t('option.none'),
    },
    ...maskGeneratorOptions.map((generator) => ({
      value: generator.id,
      label: deviceDisplayNameById[generator.id]
        ?? i18n.t(getDeviceMessageKey(generator.kind)),
    })),
  ]);
</script>

<DeviceBodyLayout kind="content" size="regular">
  <DeviceControlColumn>
    <SelectField
      label={i18n.t('control.maskSelection')}
      value={device.params.mode}
      options={maskModeOptions}
      dataAction="set-mask-mode"
      dataId={device.id}
      {onControlChange}
    />
    <SelectField
      label={i18n.t('control.source')}
      value={device.params.sourceKind}
      options={maskSourceKindOptions}
      dataAction="set-mask-source-kind"
      dataId={device.id}
      {onControlChange}
    />
    <SelectField
      label={i18n.t('control.sourceDisplay')}
      value={device.params.sourceVisibility}
      options={maskSourceVisibilityOptions}
      dataAction="set-mask-source-visibility"
      dataId={device.id}
      {onControlChange}
    />
  </DeviceControlColumn>
  <DeviceControlColumn>
    {#if device.params.sourceKind === 'tiles'}
      <MaskTilePicker
        deviceId={device.id}
        tiles={device.params.tiles}
      />
    {:else if device.params.sourceKind === 'group'}
      <SelectField
        label={i18n.t('control.group')}
        value={device.params.sourceId ?? ''}
        options={maskGroupSelectOptions}
        dataAction="set-mask-source-id"
        dataId={device.id}
        disabled={maskGroupOptions.length === 0}
        {onControlChange}
      />
    {:else}
      <SelectField
        label={i18n.t('control.generator')}
        value={device.params.sourceId ?? ''}
        options={maskGeneratorSelectOptions}
        dataAction="set-mask-source-id"
        dataId={device.id}
        disabled={maskGeneratorOptions.length === 0}
        {onControlChange}
      />
    {/if}
  </DeviceControlColumn>
</DeviceBodyLayout>
