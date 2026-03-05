<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/types';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type ReverseDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'reverse' }>;
  };

  let { device }: ReverseDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <div class="control-field">
    <span class="field-label">Action</span>
    <input type="text" value="Reverse Note Timeline" readonly data-id={device.id} />
  </div>
</div>
