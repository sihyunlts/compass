<svelte:options runes={true} />

<script lang="ts">
  import TimeWindowEditor from '../../renderer/components/controls/TimeWindowEditor.svelte';
  import type { GeneratorDeviceNode } from '../../shared/model';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { TRIM_NUMERIC_PARAMETERS } from './schema';

  type TrimDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'trim' }>;
  };

  let {
    device,
    currentProgress01,
    modulationStateByParameter,
    onControlChange,
  }: TrimDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <TimeWindowEditor
    deviceId={device.id}
    dataAction="set-trim-param"
    start={device.params.start}
    end={device.params.end}
    mode="trim"
    parameter={TRIM_NUMERIC_PARAMETERS.start}
    {currentProgress01}
    {modulationStateByParameter}
    {onControlChange}
  />
</div>
