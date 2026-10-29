<svelte:options runes={true} />

<script lang="ts">
  import { createDeviceControlLabelResolver } from '../../renderer/device-i18n';
  import { stretchDeviceControls } from './controls';
  import TimeWindowEditor from '../../renderer/components/controls/TimeWindowEditor.svelte';
  import type { GeneratorDeviceNode } from '../../shared/model';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { STRETCH_NUMERIC_PARAMETERS } from './schema';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';

  const controlLabel = createDeviceControlLabelResolver(stretchDeviceControls);

  type StretchDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'stretch' }>;
  };

  let {
    device,
    currentProgress01,
    modulationStateByParameter,
    onControlChange,
  }: StretchDeviceEditorProps = $props();
</script>

<DeviceBodyLayout kind="content" size="regular">
  <TimeWindowEditor
    startLabel={controlLabel('set-stretch-param', 'start')}
    endLabel={controlLabel('set-stretch-param', 'end')}
    deviceId={device.id}
    dataAction="set-stretch-param"
    start={device.params.start}
    end={device.params.end}
    mode="stretch"
    parameter={STRETCH_NUMERIC_PARAMETERS.start}
    {currentProgress01}
    {modulationStateByParameter}
    {onControlChange}
  />
</DeviceBodyLayout>
