<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type StretchDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'stretch' }>;
  };

  let { device }: StretchDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <div class="column-wrapper">
    <div class="control-field">
      <span class="field-label">Start</span>
      <input
        type="number"
        min="0"
        max="1"
        step="0.01"
        value={device.params.start}
        data-action="set-stretch-param"
        data-id={device.id}
        data-param="start"
      />
    </div>
    <div class="control-field">
      <span class="field-label">End</span>
      <input
        type="number"
        min="0"
        max="1"
        step="0.01"
        value={device.params.end}
        data-action="set-stretch-param"
        data-id={device.id}
        data-param="end"
      />
    </div>
  </div>
</div>
