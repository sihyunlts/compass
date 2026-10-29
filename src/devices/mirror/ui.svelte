<svelte:options runes={true} />

<script lang="ts">
  import { createDeviceControlLabelResolver } from '../../renderer/device-i18n';
  import { mirrorDeviceControls } from './controls';

  import type { GeneratorDeviceNode } from '../../shared/model';
  import AnglePicker from '../../renderer/components/controls/AnglePicker.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { MIRROR_NUMERIC_PARAMETERS } from './schema';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';

  const controlLabel = createDeviceControlLabelResolver(mirrorDeviceControls);

  type MirrorDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'mirror' }>;
  };

  let { device, modulationStateByParameter, onControlChange }: MirrorDeviceEditorProps = $props();
</script>

<DeviceBodyLayout kind="fields">
  <AnglePicker
    label={controlLabel('set-angle-param', 'angleDeg')}
    value={device.params.angleDeg}
    dataAction="set-angle-param"
    dataId={device.id}
    dataParam="angleDeg"
    parameter={MIRROR_NUMERIC_PARAMETERS.angleDeg}
    {modulationStateByParameter}
    {onControlChange}
  />
</DeviceBodyLayout>
