<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import NumberField from '../../renderer/components/NumberField.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type TranslateDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'translate' }>;
  };

  let { device }: TranslateDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <div class="column-wrapper">
    <NumberField
      label="Offset X"
      step="0.1"
      value={device.params.offsetX}
      dataAction="set-translate-param"
      dataId={device.id}
      dataParam="offsetX"
    />
    <NumberField
      label="Offset Y"
      step="0.1"
      value={device.params.offsetY}
      dataAction="set-translate-param"
      dataId={device.id}
      dataParam="offsetY"
    />
  </div>
</div>
