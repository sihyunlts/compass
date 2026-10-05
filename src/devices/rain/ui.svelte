<svelte:options runes={true} />

<script lang="ts">
  import { createDeviceControlLabelResolver } from '../../renderer/device-i18n';
  import { rainDeviceControls } from './controls';

  import type { GeneratorDeviceNode } from '../../shared/model';
  import AnglePicker from '../../renderer/components/controls/AnglePicker.svelte';
  import NumberField from '../../renderer/components/fields/NumberField.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { RAIN_NUMERIC_PARAMETERS } from './schema';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';
  import DeviceControlColumn from '../../renderer/components/rack/DeviceControlColumn.svelte';

  const controlLabel = createDeviceControlLabelResolver(rainDeviceControls);

  type RainDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'rain' }>;
  };

  let { device, modulationStateByParameter, onControlChange }: RainDeviceEditorProps = $props();
</script>

<DeviceBodyLayout kind="fields">
  <DeviceControlColumn>
    <AnglePicker
      label={controlLabel('set-angle-param', 'angleDeg')}
      value={device.params.angleDeg}
      dataAction="set-angle-param"
      dataId={device.id}
      dataParam="angleDeg"
      parameter={RAIN_NUMERIC_PARAMETERS.angleDeg}
      {modulationStateByParameter}
      {onControlChange}
    />
    <NumberField
      label={controlLabel('set-rain-param', 'seed')}
      size="compact"
      class="rain-seed-field"
      parameter={RAIN_NUMERIC_PARAMETERS.seed}
      value={device.params.seed}
      dataAction="set-rain-param"
      dataId={device.id}
      dataParam="seed"
      {modulationStateByParameter}
      {onControlChange}
    />
    <div class="rain-paired-fields">
      <NumberField
        label={controlLabel('set-rain-param', 'density')}
        size="compact"
        fill={true}
        parameter={RAIN_NUMERIC_PARAMETERS.density}
        value={device.params.density}
        dataAction="set-rain-param"
        dataId={device.id}
        dataParam="density"
        {modulationStateByParameter}
        {onControlChange}
      />
      <NumberField
        label={controlLabel('set-rain-param', 'speed')}
        size="compact"
        fill={true}
        parameter={RAIN_NUMERIC_PARAMETERS.speed}
        value={device.params.speed}
        dataAction="set-rain-param"
        dataId={device.id}
        dataParam="speed"
        {modulationStateByParameter}
        {onControlChange}
      />
    </div>
  </DeviceControlColumn>
</DeviceBodyLayout>

<style lang="scss">
  :global(.control-field.rain-seed-field) {
    --field-control-width: 100%;
    width: 100%;
  }

  .rain-paired-fields {
    display: flex;
    gap: var(--gap-6);
    min-width: 0;
  }
</style>
