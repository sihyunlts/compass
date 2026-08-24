<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import CenterPointPicker from '../../renderer/components/controls/CenterPointPicker.svelte';
  import SymmetryVisualization from '../../renderer/components/controls/SymmetryVisualization.svelte';
  import FieldShell from '../../renderer/components/fields/FieldShell.svelte';
  import NumberField from '../../renderer/components/fields/NumberField.svelte';
  import SelectField from '../../renderer/components/fields/SelectField.svelte';
  import Switch from '../../renderer/components/primitives/Switch.svelte';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { SYMMETRY_NUMERIC_PARAMETERS } from './schema';
  import { i18n } from '../../renderer/i18n.svelte';

  type SymmetryDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'symmetry' }>;
  };

  let { device, modulationStateByParameter, onControlChange }: SymmetryDeviceEditorProps = $props();

  const modeOptions = $derived([
    { value: 'reflection', label: i18n.t('option.symmetryReflect') },
    { value: 'rotation', label: i18n.t('option.symmetryRotate') },
  ]);
  const resultCountStep = $derived(device.params.mode === 'reflection' ? 2 : 1);
</script>

{#snippet symmetryOverlay()}
  <SymmetryVisualization
    mode={device.params.mode}
    sourceScope={device.params.sourceScope}
    count={device.params.count}
    directionDeg={device.params.directionDeg}
    centerX={device.params.centerX}
    centerY={device.params.centerY}
    visualizationLabel={i18n.t('control.symmetrySourceArea')}
    directionLabel={i18n.t('control.symmetryDirection')}
    directionStep={SYMMETRY_NUMERIC_PARAMETERS.directionDeg.input.step}
    onDirectionChange={(value, finalize) => onControlChange({
      action: 'set-symmetry-param',
      deviceId: device.id,
      paramKey: 'directionDeg',
      value,
      finalize,
      step: SYMMETRY_NUMERIC_PARAMETERS.directionDeg.input.step,
    })}
  />
{/snippet}

<DeviceBodyLayout kind="surface" size="wide">
  {#snippet surface()}
    <CenterPointPicker
      deviceId={device.id}
      centerX={device.params.centerX}
      centerY={device.params.centerY}
      parameter={SYMMETRY_NUMERIC_PARAMETERS.centerX}
      label={i18n.t('control.symmetrySource')}
      areaLabel={i18n.t('control.symmetrySourceArea')}
      overlay={symmetryOverlay}
      {modulationStateByParameter}
      {onControlChange}
    />
  {/snippet}

  {#snippet settings()}
    <div class="symmetry-settings">
      <SelectField
        label={i18n.t('control.symmetryMode')}
        value={device.params.mode}
        options={modeOptions}
        class="symmetry-mode"
        dataAction="set-symmetry-mode"
        dataId={device.id}
        {onControlChange}
      />
      <NumberField
        label={i18n.t('control.count')}
        value={device.params.count}
        dataAction="set-symmetry-param"
        dataId={device.id}
        dataParam="count"
        parameter={SYMMETRY_NUMERIC_PARAMETERS.count}
        step={resultCountStep}
        class={device.params.sourceScope === 'entire' ? 'symmetry-count-full' : ''}
        {onControlChange}
      />
      {#if device.params.sourceScope === 'sector'}
        <NumberField
          label={i18n.t('control.symmetryDirection')}
          value={device.params.directionDeg}
          dataAction="set-symmetry-param"
          dataId={device.id}
          dataParam="directionDeg"
          parameter={SYMMETRY_NUMERIC_PARAMETERS.directionDeg}
          {modulationStateByParameter}
          {onControlChange}
        />
      {/if}
      <FieldShell
        label={i18n.t('control.entireSource')}
        class="symmetry-entire-source-toggle"
      >
        <Switch
          checked={device.params.sourceScope === 'entire'}
          label={i18n.t('control.entireSource')}
          onCheckedChange={(checked) => onControlChange({
            action: 'set-symmetry-source-scope',
            deviceId: device.id,
            value: checked ? 'entire' : 'sector',
            finalize: true,
          })}
        />
      </FieldShell>
    </div>
  {/snippet}
</DeviceBodyLayout>

<style lang="scss">
  .symmetry-settings {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-content: start;
    gap: var(--gap-8);
    min-width: 0;
  }

  .symmetry-settings :global(.symmetry-mode),
  .symmetry-settings :global(.symmetry-count-full),
  .symmetry-settings :global(.symmetry-entire-source-toggle) {
    grid-column: 1 / -1;
  }

</style>
