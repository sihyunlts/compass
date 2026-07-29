<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import AnglePicker from '../../renderer/components/controls/AnglePicker.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { SCANNER_NUMERIC_PARAMETERS } from './schema';
  import { i18n } from '../../renderer/i18n.svelte';

  type ScannerDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'scanner' }>;
  };

  let { device, onControlChange }: ScannerDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <AnglePicker
    label={i18n.t('control.sweepDirection')}
    value={device.params.angleDeg}
    dataAction="set-angle-param"
    dataId={device.id}
    dataParam="angleDeg"
    parameter={SCANNER_NUMERIC_PARAMETERS.angleDeg}
    {onControlChange}
  />
</div>
