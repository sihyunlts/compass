<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import CurveEditor from '../../renderer/components/CurveEditor.svelte';
  import FieldShell from '../../renderer/components/FieldShell.svelte';
  import NumberField from '../../renderer/components/NumberField.svelte';
  import SelectField from '../../renderer/components/SelectField.svelte';
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
  const modulationReadoutText = $derived.by(() => {
    const rawText = modulationReadoutById[device.id] ?? 'No active modulation value';
    const separatorIndex = rawText.indexOf('|');
    return separatorIndex >= 0 ? rawText.slice(separatorIndex + 1).trim() : rawText;
  });
</script>

<div class="device-controls modulation-layout">
  <div class="modulation-sidebar">
    <div class="modulation-control-grid">
      <FieldShell label="Target Device">
        <select data-action="set-modulation-target-device" data-id={device.id}>
          <option value="" selected={!device.params.target?.deviceId}>None</option>
          {#each targetableDevices as targetDevice (targetDevice.id)}
            <option
              value={targetDevice.id}
              selected={device.params.target?.deviceId === targetDevice.id}
            >
              {deviceDisplayNameById[targetDevice.id] ?? getRendererDeviceLabel(targetDevice.kind)}
            </option>
          {/each}
        </select>
      </FieldShell>
      <FieldShell label="Target Parameter" class="modulation-control-field-wide">
        <select
          data-action="set-modulation-target-param"
          data-id={device.id}
          disabled={!selectedTargetDevice}
        >
          <option value="" selected={!device.params.target?.paramKey}>None</option>
          {#each targetParamOptions as option (option.key)}
            <option
              value={option.key}
              selected={device.params.target?.paramKey === option.key}
            >
              {option.label}
            </option>
          {/each}
        </select>
      </FieldShell>
      <div class="modulation-compact-row">
        <NumberField
          label="Amount"
          step="0.1"
          value={device.params.amount}
          dataAction="set-modulation-amount"
          dataId={device.id}
        />
        <SelectField
          label="Divisions"
          value={device.params.curve.divisions}
          options={MODULATION_DIVISION_OPTIONS}
          dataAction="set-modulation-divisions"
          dataId={device.id}
        />
      </div>
    </div>
  </div>
  <div class="modulation-main">
    <span class="modulation-readout">{modulationReadoutText}</span>
    <CurveEditor
      deviceId={device.id}
      curve={device.params.curve}
      hiddenInputAction="set-modulation-curve-nodes"
      sanitizeNodes={sanitizeCurveNodes}
      guideValue={0}
      wrapperClass="modulation-curve-control"
      {currentProgress01}
    />
  </div>
</div>
