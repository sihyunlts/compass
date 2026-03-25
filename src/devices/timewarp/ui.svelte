<svelte:options runes={true} />

<script lang="ts">
  import CurveEditor from '../../renderer/components/CurveEditor.svelte';
  import { sanitizeTimeWarpCurveNodes } from '../../core/timewarp/curve';
  import type { GeneratorDeviceNode } from '../../shared/model';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type TimeWarpDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'timewarp' }>;
  };

  let { device, currentProgress01 = 0 }: TimeWarpDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <CurveEditor
    deviceId={device.id}
    curve={device.params.curve}
    hiddenInputAction="set-timewarp-curve-nodes"
    sanitizeNodes={sanitizeTimeWarpCurveNodes}
    valueMin={0}
    valueMax={1}
    guideValue={null}
    {currentProgress01}
  />
</div>
