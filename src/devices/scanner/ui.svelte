<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/types';
  import AnglePicker from '../../renderer/components/AnglePicker.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type ScannerDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'scanner' }>;
  };

  let { device }: ScannerDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <AnglePicker
    label="Angle (0-360)"
    value={device.params.angleDeg}
    dataAction="set-angle-param"
    dataId={device.id}
    dataParam="angleDeg"
  />
  <div class="control-field">
    <span class="field-label">Start Offset</span>
    <input
      type="number"
      step="0.1"
      value={device.params.startOffset}
      data-action="set-scanner-param"
      data-id={device.id}
      data-param="startOffset"
    />
  </div>
</div>
