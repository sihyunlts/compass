<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import FieldShell from '../../renderer/components/fields/FieldShell.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type ReverseDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'reverse' }>;
  };

  let { device }: ReverseDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <FieldShell label="Action">
    <input type="text" value="Reverse Note Timeline" readonly data-id={device.id} />
  </FieldShell>
</div>
