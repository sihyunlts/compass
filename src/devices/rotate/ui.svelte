<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import AnglePicker from '../../renderer/components/controls/AnglePicker.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { ROTATE_NUMERIC_PARAMETERS } from './schema';
  import { i18n } from '../../renderer/i18n.svelte';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';

  type RotateDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'rotate' }>;
  };

  let { device, modulationStateByParameter, onControlChange }: RotateDeviceEditorProps = $props();
</script>

<DeviceBodyLayout kind="fields">
  <AnglePicker
    label={i18n.t('control.angle')}
    value={device.params.angleDeg}
    dataAction="set-rotate-param"
    dataId={device.id}
    dataParam="angleDeg"
    parameter={ROTATE_NUMERIC_PARAMETERS.angleDeg}
    {modulationStateByParameter}
    {onControlChange}
  />
</DeviceBodyLayout>
