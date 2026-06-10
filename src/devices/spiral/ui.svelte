<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import CenterPointPicker from '../../renderer/components/CenterPointPicker.svelte';
  import NumberField from '../../renderer/components/NumberField.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type SpiralDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'spiral' }>;
  };

  let { device }: SpiralDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <CenterPointPicker
    deviceId={device.id}
    centerX={device.params.centerX}
    centerY={device.params.centerY}
  />
  <NumberField
    label="Turns"
    step="0.1"
    min="0.25"
    max="8"
    value={device.params.turns}
    dataAction="set-spiral-param"
    dataId={device.id}
    dataParam="turns"
  />
</div>
