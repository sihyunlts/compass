<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/types';
  import CenterPointPicker from '../../renderer/components/CenterPointPicker.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type WaterdropDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'waterdrop' }>;
  };

  let { device }: WaterdropDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <CenterPointPicker
    deviceId={device.id}
    centerX={device.params.centerX}
    centerY={device.params.centerY}
  />
  <div class="column-wrapper">
    <div class="control-field">
      <span class="field-label">Curvature</span>
      <input
        type="number"
        step="0.1"
        value={device.params.curvature}
        data-action="set-waterdrop-param"
        data-id={device.id}
        data-param="curvature"
      />
    </div>
    <div class="control-field">
      <span class="field-label">Start Radius</span>
      <input
        type="number"
        step="0.1"
        value={device.params.startRadius}
        data-action="set-waterdrop-param"
        data-id={device.id}
        data-param="startRadius"
      />
    </div>
  </div>
</div>
