<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import AnglePicker from '../../renderer/components/controls/AnglePicker.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { MIRROR_NUMERIC_PARAMETERS } from './schema';
  import { i18n } from '../../renderer/i18n.svelte';

  type MirrorDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'mirror' }>;
  };

  let { device, onControlChange }: MirrorDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <AnglePicker
    label={i18n.t('control.mirrorAxisAngle')}
    value={device.params.angleDeg}
    dataAction="set-angle-param"
    dataId={device.id}
    dataParam="angleDeg"
    parameter={MIRROR_NUMERIC_PARAMETERS.angleDeg}
    {onControlChange}
  />
</div>
