<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import AnglePicker from '../../renderer/components/controls/AnglePicker.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { ROTATE_NUMERIC_PARAMETERS } from './schema';

  type RotateDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'rotate' }>;
  };

  let { device, onControlChange }: RotateDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <AnglePicker
    label="Rotation"
    value={device.params.angleDeg}
    dataAction="set-rotate-param"
    dataId={device.id}
    dataParam="angleDeg"
    parameter={ROTATE_NUMERIC_PARAMETERS.angleDeg}
    {onControlChange}
  />
</div>
