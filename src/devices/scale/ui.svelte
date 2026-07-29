<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import CenterPointPicker from '../../renderer/components/controls/CenterPointPicker.svelte';
  import NumberField from '../../renderer/components/fields/NumberField.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { SCALE_NUMERIC_PARAMETERS } from './schema';

  type ScaleDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'scale' }>;
  };

  let { device, onControlChange }: ScaleDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <CenterPointPicker
    deviceId={device.id}
    centerX={device.params.centerX}
    centerY={device.params.centerY}
    parameter={SCALE_NUMERIC_PARAMETERS.centerX}
    {onControlChange}
  />
  <div class="column-wrapper">
    <NumberField
      label="Scale X"
      parameter={SCALE_NUMERIC_PARAMETERS.scaleX}
      value={device.params.scaleX}
      dataAction="set-scale-param"
      dataId={device.id}
      dataParam="scaleX"
      {onControlChange}
    />
    <NumberField
      label="Scale Y"
      parameter={SCALE_NUMERIC_PARAMETERS.scaleY}
      value={device.params.scaleY}
      dataAction="set-scale-param"
      dataId={device.id}
      dataParam="scaleY"
      {onControlChange}
    />
  </div>
</div>
