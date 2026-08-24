<svelte:options runes={true} />

<script lang="ts">
  import CurveEditor from '../../renderer/components/controls/CurveEditor.svelte';
  import { sanitizeTimeWarpCurveNodes } from '../../core/timewarp/curve';
  import type { GeneratorDeviceNode } from '../../shared/model';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { i18n } from '../../renderer/i18n.svelte';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';

  type TimeWarpDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'timewarp' }>;
  };

  let { device, currentProgress01 = 0, onControlChange }: TimeWarpDeviceEditorProps = $props();
</script>

<DeviceBodyLayout kind="graph">
  <CurveEditor
    label={i18n.t('tab.curve')}
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
