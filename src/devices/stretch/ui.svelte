<svelte:options runes={true} />

<script lang="ts">
  import TimeWindowEditor from '../../renderer/components/TimeWindowEditor.svelte';
  import type { GeneratorDeviceNode } from '../../shared/model';
  import { clamp } from '../../shared/math';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type StretchDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'stretch' }>;
  };

  let { device, currentProgress01 }: StretchDeviceEditorProps = $props();

  const speedBadgeText = $derived.by(() => {
    const selectedLength = clamp(device.params.end - device.params.start, 0, 1);
    if (selectedLength <= 0) {
      return 'Invalid span';
    }

    const speedMultiplier = 1 / selectedLength;
    for (let multiplier = 1; multiplier <= 16; multiplier += 1) {
      if (Math.abs(speedMultiplier - multiplier) < 0.0001) {
        return `${multiplier}x`;
      }
    }

    return `${Number(speedMultiplier.toFixed(3)).toString()}x`;
  });
</script>

<div class="device-controls">
  <TimeWindowEditor
    deviceId={device.id}
    dataAction="set-stretch-param"
    start={device.params.start}
    end={device.params.end}
    mode="stretch"
    modeBadgeText={speedBadgeText}
    {currentProgress01}
  />
</div>
