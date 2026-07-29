<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import AnglePicker from '../../renderer/components/controls/AnglePicker.svelte';
  import NumberField from '../../renderer/components/fields/NumberField.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { RAIN_NUMERIC_PARAMETERS } from './schema';

  type RainDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'rain' }>;
  };

  let { device, onControlChange }: RainDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <AnglePicker
    label="Direction"
    value={device.params.angleDeg}
    dataAction="set-angle-param"
    dataId={device.id}
    dataParam="angleDeg"
    parameter={RAIN_NUMERIC_PARAMETERS.angleDeg}
    {onControlChange}
  />
  <div class="column-wrapper">
    <NumberField
      label="Seed"
      parameter={RAIN_NUMERIC_PARAMETERS.seed}
      value={device.params.seed}
      dataAction="set-rain-param"
      dataId={device.id}
      dataParam="seed"
      {onControlChange}
    />
    <NumberField
      label="Density"
      parameter={RAIN_NUMERIC_PARAMETERS.density}
      value={device.params.density}
      dataAction="set-rain-param"
      dataId={device.id}
      dataParam="density"
      {onControlChange}
    />
    <NumberField
      label="Speed"
      parameter={RAIN_NUMERIC_PARAMETERS.speed}
      value={device.params.speed}
      dataAction="set-rain-param"
      dataId={device.id}
      dataParam="speed"
      {onControlChange}
    />
  </div>
</div>
