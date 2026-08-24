<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import NumberField from '../../renderer/components/fields/NumberField.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { TRANSLATE_NUMERIC_PARAMETERS } from './schema';
  import { i18n } from '../../renderer/i18n.svelte';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';
  import DeviceControlColumn from '../../renderer/components/rack/DeviceControlColumn.svelte';

  type TranslateDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'translate' }>;
  };

  let { device, modulationStateByParameter, onControlChange }: TranslateDeviceEditorProps = $props();
</script>

<DeviceBodyLayout kind="fields" size="regular">
  <DeviceControlColumn>
    <NumberField
      label={i18n.t('control.offsetX')}
      parameter={TRANSLATE_NUMERIC_PARAMETERS.offsetX}
      value={device.params.offsetX}
      dataAction="set-translate-param"
      dataId={device.id}
      dataParam="offsetX"
      {modulationStateByParameter}
      {onControlChange}
    />
    <NumberField
      label={i18n.t('control.offsetY')}
      parameter={TRANSLATE_NUMERIC_PARAMETERS.offsetY}
      value={device.params.offsetY}
      dataAction="set-translate-param"
      dataId={device.id}
      dataParam="offsetY"
      {modulationStateByParameter}
      {onControlChange}
    />
  </DeviceControlColumn>
</DeviceBodyLayout>
