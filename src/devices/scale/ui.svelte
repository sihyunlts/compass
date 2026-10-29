<svelte:options runes={true} />

<script lang="ts">
  import { createDeviceControlLabelResolver } from '../../renderer/device-i18n';
  import { scaleDeviceControls } from './controls';

  import type { GeneratorDeviceNode } from '../../shared/model';
  import CenterPointPicker from '../../renderer/components/controls/CenterPointPicker.svelte';
  import NumberField from '../../renderer/components/fields/NumberField.svelte';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { SCALE_NUMERIC_PARAMETERS } from './schema';

  const controlLabel = createDeviceControlLabelResolver(scaleDeviceControls);

  type ScaleDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'scale' }>;
  };

  let { device, modulationStateByParameter, onControlChange }: ScaleDeviceEditorProps = $props();
</script>

<DeviceBodyLayout kind="surface">
  {#snippet surface()}
    <CenterPointPicker
      deviceId={device.id}
      centerX={device.params.centerX}
      centerY={device.params.centerY}
      parameter={SCALE_NUMERIC_PARAMETERS.centerX}
      {modulationStateByParameter}
      {onControlChange}
    />
  {/snippet}
  {#snippet settings()}
    <NumberField
      label={controlLabel('set-scale-param', 'scaleX')}
      parameter={SCALE_NUMERIC_PARAMETERS.scaleX}
      value={device.params.scaleX}
      dataAction="set-scale-param"
      dataId={device.id}
      dataParam="scaleX"
      {modulationStateByParameter}
      {onControlChange}
    />
    <NumberField
      label={controlLabel('set-scale-param', 'scaleY')}
      parameter={SCALE_NUMERIC_PARAMETERS.scaleY}
      value={device.params.scaleY}
      dataAction="set-scale-param"
      dataId={device.id}
      dataParam="scaleY"
      {modulationStateByParameter}
      {onControlChange}
    />
  {/snippet}
</DeviceBodyLayout>
