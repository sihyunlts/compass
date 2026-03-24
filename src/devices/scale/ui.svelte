<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import CenterPointPicker from '../../renderer/components/CenterPointPicker.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type ScaleDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'scale' }>;
  };

  let { device }: ScaleDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <CenterPointPicker
    deviceId={device.id}
    centerX={device.params.centerX}
    centerY={device.params.centerY}
  />
  <div class="column-wrapper">
    <div class="control-field">
      <span class="field-label">Scale X</span>
      <input
        type="number"
        step="0.1"
        min="0.000001"
        value={device.params.scaleX}
        data-action="set-scale-param"
        data-id={device.id}
        data-param="scaleX"
      />
    </div>
    <div class="control-field">
      <span class="field-label">Scale Y</span>
      <input
        type="number"
        step="0.1"
        min="0.000001"
        value={device.params.scaleY}
        data-action="set-scale-param"
        data-id={device.id}
        data-param="scaleY"
      />
    </div>
  </div>
</div>
