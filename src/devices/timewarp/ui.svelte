<svelte:options runes={true} />

<script lang="ts">
  import { createDeviceControlLabelResolver } from '../../renderer/device-i18n';
  import { timeWarpDeviceControls } from './controls';

  import CurveEditor from '../../renderer/components/controls/CurveEditor.svelte';
  import { sanitizeTimeWarpCurveNodes } from '../../core/timewarp/curve';
  import type { GeneratorDeviceNode } from '../../shared/model';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';

  const controlLabel = createDeviceControlLabelResolver(timeWarpDeviceControls);

  type TimeWarpDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'timewarp' }>;
  };

  let { device, currentProgress01 = 0, onControlChange }: TimeWarpDeviceEditorProps = $props();
</script>

<DeviceBodyLayout kind="graph">
  <CurveEditor
      divisionsLabel={controlLabel('set-timewarp-divisions')}
    label={controlLabel('set-timewarp-curve-nodes')}
    deviceId={device.id}
    curve={device.params.curve}
    controlAction="set-timewarp-curve-nodes"
    sanitizeNodes={sanitizeTimeWarpCurveNodes}
    valueMin={0}
    valueMax={1}
    guideValue={null}
    divisionsControlAction="set-timewarp-divisions"
    {currentProgress01}
    {onControlChange}
  />
</DeviceBodyLayout>
