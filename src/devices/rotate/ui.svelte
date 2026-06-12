<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import AnglePicker from '../../renderer/components/controls/AnglePicker.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type RotateDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'rotate' }>;
  };

  let { device, onControlChange }: RotateDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <AnglePicker
    label="Angle (0-360)"
    value={device.params.angleDeg}
    dataAction="set-angle-param"
    dataId={device.id}
    dataParam="angleDeg"
    {onControlChange}
  />
</div>
