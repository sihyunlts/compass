<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type TranslateDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'translate' }>;
  };

  let { device }: TranslateDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <div class="column-wrapper">
    <div class="control-field">
      <span class="field-label">Offset X</span>
      <input
        type="number"
        step="0.1"
        value={device.params.offsetX}
        data-action="set-translate-param"
        data-id={device.id}
        data-param="offsetX"
      />
    </div>
    <div class="control-field">
      <span class="field-label">Offset Y</span>
      <input
        type="number"
        step="0.1"
        value={device.params.offsetY}
        data-action="set-translate-param"
        data-id={device.id}
        data-param="offsetY"
      />
    </div>
  </div>
</div>
