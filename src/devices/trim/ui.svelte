<svelte:options runes={true} />

<script lang="ts">
  import TimeWindowEditor from '../../renderer/components/TimeWindowEditor.svelte';
  import type { GeneratorDeviceNode } from '../../shared/model';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type TrimDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'trim' }>;
  };

  let { device, currentBeat }: TrimDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <TimeWindowEditor
    deviceId={device.id}
    dataAction="set-trim-param"
    start={device.params.start}
    end={device.params.end}
    {currentBeat}
  />
</div>
