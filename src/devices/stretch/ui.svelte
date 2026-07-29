<svelte:options runes={true} />

<script lang="ts">
  import TimeWindowEditor from '../../renderer/components/controls/TimeWindowEditor.svelte';
  import type { GeneratorDeviceNode } from '../../shared/model';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { STRETCH_NUMERIC_PARAMETERS } from './schema';

  type StretchDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'stretch' }>;
  };

  let { device, currentProgress01, onControlChange }: StretchDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <TimeWindowEditor
    deviceId={device.id}
    dataAction="set-stretch-param"
    start={device.params.start}
    end={device.params.end}
    mode="stretch"
    parameter={STRETCH_NUMERIC_PARAMETERS.start}
    {currentProgress01}
    {onControlChange}
  />
</div>
