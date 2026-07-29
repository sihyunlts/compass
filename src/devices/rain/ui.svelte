<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import AnglePicker from '../../renderer/components/controls/AnglePicker.svelte';
  import NumberField from '../../renderer/components/fields/NumberField.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { RAIN_NUMERIC_PARAMETERS } from './schema';
  import { i18n } from '../../renderer/i18n.svelte';

  type RainDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'rain' }>;
  };

  let { device, onControlChange }: RainDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <AnglePicker
    label={i18n.t('control.direction')}
    value={device.params.angleDeg}
    dataAction="set-angle-param"
    dataId={device.id}
    dataParam="angleDeg"
    parameter={RAIN_NUMERIC_PARAMETERS.angleDeg}
    {onControlChange}
  />
  <div class="column-wrapper">
    <NumberField
      label={i18n.t('control.seed')}
      parameter={RAIN_NUMERIC_PARAMETERS.seed}
      value={device.params.seed}
      dataAction="set-rain-param"
      dataId={device.id}
      dataParam="seed"
      {onControlChange}
    />
    <NumberField
      label={i18n.t('control.density')}
      parameter={RAIN_NUMERIC_PARAMETERS.density}
      value={device.params.density}
      dataAction="set-rain-param"
      dataId={device.id}
      dataParam="density"
      {onControlChange}
    />
    <NumberField
      label={i18n.t('control.speed')}
      parameter={RAIN_NUMERIC_PARAMETERS.speed}
      value={device.params.speed}
      dataAction="set-rain-param"
      dataId={device.id}
      dataParam="speed"
      {onControlChange}
    />
  </div>
</div>
