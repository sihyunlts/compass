<svelte:options runes={true} />

<script lang="ts">
  import { createDeviceControlLabelResolver } from '../../renderer/device-i18n';
  import { trimDeviceControls } from './controls';
  import TimeWindowEditor from '../../renderer/components/controls/TimeWindowEditor.svelte';
  import type { GeneratorDeviceNode } from '../../shared/model';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { TRIM_NUMERIC_PARAMETERS } from './schema';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';

  const controlLabel = createDeviceControlLabelResolver(trimDeviceControls);

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

<DeviceBodyLayout kind="content" size="regular">
  <TimeWindowEditor
    startLabel={controlLabel('set-trim-param', 'start')}
    endLabel={controlLabel('set-trim-param', 'end')}
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
</DeviceBodyLayout>
