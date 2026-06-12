<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import CurveEditor from '../../renderer/components/controls/CurveEditor.svelte';
  import NumberField from '../../renderer/components/fields/NumberField.svelte';
  import SelectField from '../../renderer/components/fields/SelectField.svelte';
  import { sanitizeCurveNodes } from '../../core/modulation/curve';
  import {
    getRendererDeviceLabel,
    getRendererModulationTargetParamDefinitions,
  } from '../schema-registry';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type ModulatorDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'modulator' }>;
  };

  const MODULATION_DIVISION_OPTIONS = [4, 8, 16, 32, 64].map((divisions) => ({
    value: divisions,
    label: String(divisions),
  }));

  let {
    device,
    devices = [] as GeneratorDeviceNode[],
    deviceDisplayNameById = {},
    currentProgress01 = 0,
    modulationReadoutById = {},
    onControlChange,
  }: ModulatorDeviceEditorProps = $props();

  const targetableDevices = $derived.by((): GeneratorDeviceNode[] =>
    devices.filter((item: GeneratorDeviceNode) =>
      item.id !== device.id && getRendererModulationTargetParamDefinitions(item.kind).length > 0));
  const selectedTargetDevice = $derived.by(() =>
    targetableDevices.find(
      (item: GeneratorDeviceNode) => item.id === device.params.target?.deviceId,
    ) ?? null);
  const targetParamOptions = $derived.by(() =>
    selectedTargetDevice
      ? getRendererModulationTargetParamDefinitions(selectedTargetDevice.kind)
      : []);
  const targetDeviceSelectOptions = $derived.by(() => [
    { value: '', label: 'None' },
    ...targetableDevices.map((targetDevice) => ({
      value: targetDevice.id,
      label: deviceDisplayNameById[targetDevice.id] ?? getRendererDeviceLabel(targetDevice.kind),
    })),
  ]);
  const targetParamSelectOptions = $derived.by(() => [
    { value: '', label: 'None' },
    ...targetParamOptions.map((option) => ({
      value: option.key,
      label: option.label,
    })),
  ]);
  const modulationReadoutText = $derived.by(() => {
    const rawText = modulationReadoutById[device.id] ?? 'No active modulation value';
    const separatorIndex = rawText.indexOf('|');
    return separatorIndex >= 0 ? rawText.slice(separatorIndex + 1).trim() : rawText;
  });
</script>

<div class="device-controls modulation-layout">
  <div class="column-wrapper modulation-sidebar">
    <SelectField
      label="Target Device"
      value={device.params.target?.deviceId ?? ''}
      options={targetDeviceSelectOptions}
      dataAction="set-modulation-target-device"
      dataId={device.id}
      {onControlChange}
    />
    <SelectField
      label="Target Parameter"
      value={device.params.target?.paramKey ?? ''}
      options={targetParamSelectOptions}
      dataAction="set-modulation-target-param"
      dataId={device.id}
      disabled={!selectedTargetDevice}
      class="modulation-control-field-wide"
      {onControlChange}
    />
    <div class="modulation-compact-row">
      <NumberField
        label="Amount"
        step="0.1"
        value={device.params.amount}
        dataAction="set-modulation-amount"
        dataId={device.id}
        {onControlChange}
      />
      <SelectField
        label="Divisions"
        value={device.params.curve.divisions}
        options={MODULATION_DIVISION_OPTIONS}
        dataAction="set-modulation-divisions"
        dataId={device.id}
        {onControlChange}
      />
    </div>
  </div>
  <div class="column-wrapper modulation-main">
    <CurveEditor
      label={modulationReadoutText}
      deviceId={device.id}
      curve={device.params.curve}
      controlAction="set-modulation-curve-nodes"
      sanitizeNodes={sanitizeCurveNodes}
      guideValue={0}
      wrapperClass="modulation-curve-control"
      {currentProgress01}
      {onControlChange}
    />
  </div>
</div>

<style lang="scss">
  .modulation-sidebar {
    flex: 0 0 10rem;
    min-width: 0;
  }

  .modulation-main {
    flex: 1 1 12rem;
    min-width: 12rem;
    min-height: 0;
  }

  .modulation-sidebar,
  .modulation-main {
    :global(.control-field) {
      width: 100%;
      min-width: 0;
    }

    :global(.control-field input),
    :global(.control-field .dropdown-select),
    :global(.control-field .dropdown-select-trigger) {
      width: 100%;
    }
  }

  .modulation-main {
    :global(.modulation-curve-control) {
      flex: 1 1 auto;
      min-height: 0;
    }
  }

  .modulation-compact-row {
    display: flex;
    gap: var(--gap-6);
    min-width: 0;

    :global(.control-field) {
      flex: 1 1 0;
    }
  }
</style>
