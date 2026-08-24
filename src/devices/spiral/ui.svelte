<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import CenterPointPicker from '../../renderer/components/controls/CenterPointPicker.svelte';
  import NumberField from '../../renderer/components/fields/NumberField.svelte';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { SPIRAL_NUMERIC_PARAMETERS } from './schema';
  import { i18n } from '../../renderer/i18n.svelte';

  type SpiralDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'spiral' }>;
  };

  let { device, modulationStateByParameter, onControlChange }: SpiralDeviceEditorProps = $props();
</script>

<DeviceBodyLayout kind="surface">
  {#snippet surface()}
    <CenterPointPicker
      deviceId={device.id}
      centerX={device.params.centerX}
      centerY={device.params.centerY}
      parameter={SPIRAL_NUMERIC_PARAMETERS.centerX}
      {modulationStateByParameter}
      {onControlChange}
    />
  {/snippet}
  {#snippet settings()}
    <NumberField
      label={i18n.t('control.turns')}
      parameter={SPIRAL_NUMERIC_PARAMETERS.turns}
      value={device.params.turns}
      dataAction="set-spiral-param"
      dataId={device.id}
      dataParam="turns"
      {modulationStateByParameter}
      {onControlChange}
    />
  {/snippet}
</DeviceBodyLayout>
