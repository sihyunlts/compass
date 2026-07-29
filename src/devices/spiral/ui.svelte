<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import CenterPointPicker from '../../renderer/components/controls/CenterPointPicker.svelte';
  import NumberField from '../../renderer/components/fields/NumberField.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { SPIRAL_NUMERIC_PARAMETERS } from './schema';

  type SpiralDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'spiral' }>;
  };

  let { device, onControlChange }: SpiralDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <CenterPointPicker
    deviceId={device.id}
    centerX={device.params.centerX}
    centerY={device.params.centerY}
    parameter={SPIRAL_NUMERIC_PARAMETERS.centerX}
    {onControlChange}
  />
  <NumberField
    label="Turns"
    parameter={SPIRAL_NUMERIC_PARAMETERS.turns}
    value={device.params.turns}
    dataAction="set-spiral-param"
    dataId={device.id}
    dataParam="turns"
    {onControlChange}
  />
</div>
