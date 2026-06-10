<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import CenterPointPicker from '../../renderer/components/CenterPointPicker.svelte';
  import NumberField from '../../renderer/components/NumberField.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type ScaleDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'scale' }>;
  };

  let { device }: ScaleDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <CenterPointPicker
    deviceId={device.id}
    centerX={device.params.centerX}
    centerY={device.params.centerY}
  />
  <div class="column-wrapper">
    <NumberField
      label="Scale X"
      step="0.1"
      min="0.000001"
      value={device.params.scaleX}
      dataAction="set-scale-param"
      dataId={device.id}
      dataParam="scaleX"
    />
    <NumberField
      label="Scale Y"
      step="0.1"
      min="0.000001"
      value={device.params.scaleY}
      dataAction="set-scale-param"
      dataId={device.id}
      dataParam="scaleY"
    />
  </div>
</div>
