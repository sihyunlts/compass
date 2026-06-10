<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import PathEditor from '../../renderer/components/controls/PathEditor.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type PathDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'path' }>;
  };

  let { device }: PathDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <PathEditor
    deviceId={device.id}
    points={device.params.points}
  />
</div>
