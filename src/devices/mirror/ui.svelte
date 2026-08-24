<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import AnglePicker from '../../renderer/components/controls/AnglePicker.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { MIRROR_NUMERIC_PARAMETERS } from './schema';
  import { i18n } from '../../renderer/i18n.svelte';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';

  type MirrorDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'mirror' }>;
  };

  let { device, modulationStateByParameter, onControlChange }: MirrorDeviceEditorProps = $props();
</script>

<DeviceBodyLayout kind="fields">
  <AnglePicker
    label={i18n.t('control.mirrorAxis')}
    value={device.params.angleDeg}
    dataAction="set-angle-param"
    dataId={device.id}
    dataParam="angleDeg"
    parameter={MIRROR_NUMERIC_PARAMETERS.angleDeg}
    {modulationStateByParameter}
    {onControlChange}
  />
</DeviceBodyLayout>
