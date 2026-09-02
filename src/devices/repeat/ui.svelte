<svelte:options runes={true} />

<script lang="ts">
  import NumberField from '../../renderer/components/fields/NumberField.svelte';
  import RepeatTimeline from '../../renderer/components/controls/RepeatTimeline.svelte';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';
  import { i18n } from '../../renderer/i18n.svelte';
  import type { GeneratorDeviceNode } from '../../shared/model';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { REPEAT_NUMERIC_PARAMETERS } from './schema';

  type RepeatDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'repeat' }>;
  };

  let {
    device,
    currentProgress01,
    onControlChange,
  }: RepeatDeviceEditorProps = $props();
</script>

<DeviceBodyLayout kind="content" size="regular">
  <div class="repeat-editor">
    <RepeatTimeline
      count={device.params.count}
      intervalPercent={device.params.intervalPercent}
      {currentProgress01}
      label={i18n.t('control.repeatTimeline')}
    />

    <div class="repeat-inputs">
      <NumberField
        label={i18n.t('control.repeats')}
        parameter={REPEAT_NUMERIC_PARAMETERS.count}
        value={device.params.count}
        dataAction="set-repeat-param"
        dataId={device.id}
        dataParam="count"
        {onControlChange}
      />
      <NumberField
        label={i18n.t('control.interval')}
        parameter={REPEAT_NUMERIC_PARAMETERS.intervalPercent}
        value={device.params.intervalPercent}
        dataAction="set-repeat-param"
        dataId={device.id}
        dataParam="intervalPercent"
        {onControlChange}
      />
    </div>
  </div>
</DeviceBodyLayout>

<style lang="scss">
  .repeat-editor {
    display: flex;
    flex-direction: column;
    gap: var(--gap-8);
    width: calc(var(--field-control-width) * 2 + var(--gap-8));
    min-width: 0;
  }

  .repeat-inputs {
    display: flex;
    align-items: flex-start;
    gap: var(--gap-8);
    min-width: 0;
  }
</style>
