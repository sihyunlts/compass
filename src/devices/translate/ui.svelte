<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import NumberField from '../../renderer/components/fields/NumberField.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { TRANSLATE_NUMERIC_PARAMETERS } from './schema';

  type TranslateDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'translate' }>;
  };

  let { device, onControlChange }: TranslateDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <div class="column-wrapper">
    <NumberField
      label="Offset X"
      parameter={TRANSLATE_NUMERIC_PARAMETERS.offsetX}
      value={device.params.offsetX}
      dataAction="set-translate-param"
      dataId={device.id}
      dataParam="offsetX"
      {onControlChange}
    />
    <NumberField
      label="Offset Y"
      parameter={TRANSLATE_NUMERIC_PARAMETERS.offsetY}
      value={device.params.offsetY}
      dataAction="set-translate-param"
      dataId={device.id}
      dataParam="offsetY"
      {onControlChange}
    />
  </div>
</div>
