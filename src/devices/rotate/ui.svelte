<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import AnglePicker from '../../renderer/components/controls/AnglePicker.svelte';
  import CenterPointPicker from '../../renderer/components/controls/CenterPointPicker.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { ROTATE_NUMERIC_PARAMETERS } from './schema';
  import { i18n } from '../../renderer/i18n.svelte';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';

  type RotateDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'rotate' }>;
  };

  let { device, modulationStateByParameter, onControlChange }: RotateDeviceEditorProps = $props();
</script>

<DeviceBodyLayout
  kind="surface"
  controlWidth="calc(var(--gap-32) + var(--gap-8) + var(--gap-8) + 4rem)"
>
  {#snippet surface()}
    <CenterPointPicker
      deviceId={device.id}
      centerX={device.params.centerX}
      centerY={device.params.centerY}
      parameter={ROTATE_NUMERIC_PARAMETERS.centerX}
      {modulationStateByParameter}
      {onControlChange}
    />
  {/snippet}
  {#snippet settings()}
    <div class="rotate-settings">
      <AnglePicker
        label={i18n.t('control.angle')}
        value={device.params.angleDeg}
        dataAction="set-rotate-param"
        dataId={device.id}
        dataParam="angleDeg"
        parameter={ROTATE_NUMERIC_PARAMETERS.angleDeg}
        {modulationStateByParameter}
        {onControlChange}
      />
    </div>
  {/snippet}
</DeviceBodyLayout>

<style lang="scss">
  .rotate-settings {
    --field-control-width: 4rem;
  }
</style>
