<svelte:options runes={true} />

<script lang="ts">
  import { createDeviceControlLabelResolver } from '../../renderer/device-i18n';
  import { scannerDeviceControls } from './controls';

  import type { GeneratorDeviceNode } from '../../shared/model';
  import AnglePicker from '../../renderer/components/controls/AnglePicker.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { SCANNER_NUMERIC_PARAMETERS } from './schema';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';

  const controlLabel = createDeviceControlLabelResolver(scannerDeviceControls);

  type ScannerDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'scanner' }>;
  };

  let { device, modulationStateByParameter, onControlChange }: ScannerDeviceEditorProps = $props();
</script>

<DeviceBodyLayout kind="fields">
  <AnglePicker
    label={controlLabel('set-angle-param', 'angleDeg')}
    value={device.params.angleDeg}
    dataAction="set-angle-param"
    dataId={device.id}
    dataParam="angleDeg"
    parameter={SCANNER_NUMERIC_PARAMETERS.angleDeg}
    {modulationStateByParameter}
    {onControlChange}
  />
</DeviceBodyLayout>
