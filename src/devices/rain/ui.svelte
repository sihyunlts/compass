<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import AnglePicker from '../../renderer/components/controls/AnglePicker.svelte';
  import NumberField from '../../renderer/components/fields/NumberField.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import {
    RAIN_DENSITY_MAX,
    RAIN_DENSITY_MIN,
    RAIN_SEED_MAX,
    RAIN_SEED_MIN,
    RAIN_SPEED_MAX,
    RAIN_SPEED_MIN,
  } from './schema';

  type RainDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'rain' }>;
  };

  let { device, onControlChange }: RainDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <AnglePicker
    label="Direction (0-360)"
    value={device.params.angleDeg}
    dataAction="set-angle-param"
    dataId={device.id}
    dataParam="angleDeg"
    {onControlChange}
  />
  <div class="column-wrapper">
    <NumberField
      label="Seed"
      step="1"
      min={RAIN_SEED_MIN}
      max={RAIN_SEED_MAX}
      value={device.params.seed}
      dataAction="set-rain-param"
      dataId={device.id}
      dataParam="seed"
      {onControlChange}
    />
    <NumberField
      label="Density"
      step="1"
      min={RAIN_DENSITY_MIN}
      max={RAIN_DENSITY_MAX}
      value={device.params.density}
      dataAction="set-rain-param"
      dataId={device.id}
      dataParam="density"
      {onControlChange}
    />
    <NumberField
      label="Speed"
      step="0.1"
      min={RAIN_SPEED_MIN}
      max={RAIN_SPEED_MAX}
      value={device.params.speed}
      dataAction="set-rain-param"
      dataId={device.id}
      dataParam="speed"
      {onControlChange}
    />
  </div>
</div>
