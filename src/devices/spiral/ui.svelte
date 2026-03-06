<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import CenterPointPicker from '../../renderer/components/CenterPointPicker.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type SpiralDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'spiral' }>;
  };

  let { device }: SpiralDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <CenterPointPicker
    deviceId={device.id}
    centerX={device.params.centerX}
    centerY={device.params.centerY}
  />
  <div class="column-wrapper">
    <div class="control-field">
      <span class="field-label">Turns</span>
      <input
        type="number"
        step="0.1"
        min="0.25"
        max="8"
        value={device.params.turns}
        data-action="set-spiral-param"
        data-id={device.id}
        data-param="turns"
      />
    </div>
    <div class="control-field">
      <span class="field-label">Start Radius</span>
      <input
        type="number"
        step="0.1"
        value={device.params.startRadius}
        data-action="set-spiral-param"
        data-id={device.id}
        data-param="startRadius"
      />
    </div>
  </div>
</div>
