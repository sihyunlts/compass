<svelte:options runes={true} />

<script lang="ts">
  import TimeWindowEditor from '../../renderer/components/controls/TimeWindowEditor.svelte';
  import type { GeneratorDeviceNode } from '../../shared/model';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type StretchDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'stretch' }>;
  };

  let { device, currentProgress01 }: StretchDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <TimeWindowEditor
    deviceId={device.id}
    dataAction="set-stretch-param"
    start={device.params.start}
    end={device.params.end}
    mode="stretch"
    {currentProgress01}
  />
</div>
