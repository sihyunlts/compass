<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import CurveEditor from '../../renderer/components/CurveEditor.svelte';
  import {
    getRendererDeviceLabel,
    getRendererModulationTargetParamDefinitions,
  } from '../schema-registry';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type ModulatorDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'modulator' }>;
  };

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
      <div class="control-field">
        <span class="field-label">Target Device</span>
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
      </div>
      <div class="control-field modulation-control-field-wide">
        <span class="field-label">Target Parameter</span>
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
      </div>
      <div class="modulation-compact-row">
        <div class="control-field">
          <span class="field-label">Amount</span>
          <input
            type="number"
            step="0.1"
            value={device.params.amount}
            data-action="set-modulation-amount"
            data-id={device.id}
          />
        </div>
        <div class="control-field">
          <span class="field-label">Divisions</span>
          <select data-action="set-modulation-divisions" data-id={device.id}>
            {#each [4, 8, 16, 32, 64] as divisions (divisions)}
              <option value={divisions} selected={device.params.curve.divisions === divisions}>
                {divisions}
              </option>
            {/each}
          </select>
        </div>
      </div>
    </div>
  </div>
  <div class="modulation-main">
    <span class="modulation-readout">{modulationReadoutText}</span>
    <CurveEditor
      deviceId={device.id}
      curve={device.params.curve}
      {currentProgress01}
    />
  </div>
</div>
