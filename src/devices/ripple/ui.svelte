<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import CenterPointPicker from '../../renderer/components/controls/CenterPointPicker.svelte';
  import NumberField from '../../renderer/components/fields/NumberField.svelte';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';
  import { i18n } from '../../renderer/i18n.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { RIPPLE_NUMERIC_PARAMETERS } from './schema';

  type RippleDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'ripple' }>;
  };

  let { device, modulationStateByParameter, onControlChange }: RippleDeviceEditorProps = $props();
</script>

<DeviceBodyLayout kind="surface">
  {#snippet surface()}
    <CenterPointPicker
      deviceId={device.id}
      centerX={device.params.centerX}
      centerY={device.params.centerY}
      parameter={RIPPLE_NUMERIC_PARAMETERS.centerX}
      {modulationStateByParameter}
      {onControlChange}
    />
  {/snippet}
  {#snippet settings()}
    <NumberField
      label={i18n.t('control.curvature')}
      parameter={RIPPLE_NUMERIC_PARAMETERS.curvature}
      value={device.params.curvature}
      dataAction="set-ripple-param"
      dataId={device.id}
      dataParam="curvature"
      {modulationStateByParameter}
      {onControlChange}
    />
  {/snippet}
</DeviceBodyLayout>
