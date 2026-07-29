<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode, ModulationTarget } from '../../shared/model';
  import CurveEditor from '../../renderer/components/controls/CurveEditor.svelte';
  import NumberField from '../../renderer/components/fields/NumberField.svelte';
  import SelectField from '../../renderer/components/fields/SelectField.svelte';
  import ValueButton from '../../renderer/components/primitives/ValueButton.svelte';
  import { sanitizeCurveNodes } from '../../core/modulation/curve';
  import { MODULATION_TARGET_SLOT_COUNT } from '../../core/modulation/targets';
  import type {
    ModulationParameterDefinition,
    NumericParameterUnit,
  } from '../numeric-parameters';
  import {
    getRendererDeviceLabel,
    getRendererModulationTargetParamDefinitions,
  } from '../schema-registry';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type ModulatorDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'modulator' }>;
    activeModulationTargetSlotIndex?: number | null;
    onModulationTargetSlotSelect?: (slotIndex: number) => void;
  };

  const MODULATION_DIVISION_OPTIONS = [4, 8, 16, 32, 64].map((divisions) => ({
    value: divisions,
    label: String(divisions),
  }));
  type TargetSlotRow =
    | {
        kind: 'target';
        target: ModulationTarget;
      }
    | {
        kind: 'empty';
        id: string;
      };

  let {
    device,
    devices = [] as GeneratorDeviceNode[],
    deviceDisplayNameById = {},
    currentProgress01 = 0,
    modulationReadoutById = {},
    activeDeviceTab = 'curve',
    activeModulationTargetSlotIndex = null,
    onModulationTargetSlotSelect,
    onControlChange,
  }: ModulatorDeviceEditorProps = $props();

  const targetableDevices = $derived.by((): GeneratorDeviceNode[] =>
    devices.filter((item: GeneratorDeviceNode) =>
      item.id !== device.id && getRendererModulationTargetParamDefinitions(item.kind).length > 0));
  const modulationReadoutText = $derived.by(() => {
    const rawText = modulationReadoutById[device.id] ?? 'No active modulation value';
    const separatorIndex = rawText.indexOf('|');
    return separatorIndex >= 0 ? rawText.slice(separatorIndex + 1).trim() : rawText;
  });
  const activeTab = $derived(activeDeviceTab === 'map' ? 'map' : 'curve');
  const targetSlotRows = $derived.by((): TargetSlotRow[] => {
    const rows: TargetSlotRow[] = Array.from(
      { length: MODULATION_TARGET_SLOT_COUNT },
      (_, index): TargetSlotRow => ({
        kind: 'empty',
        id: `empty-target-slot-${index}`,
      }),
    );
    for (const target of device.params.targets) {
      if (
        target.slotIndex < 0
        || target.slotIndex >= MODULATION_TARGET_SLOT_COUNT
        || rows[target.slotIndex].kind === 'target'
      ) {
        continue;
      }
      rows[target.slotIndex] = {
        kind: 'target',
        target,
      };
    }

    return rows;
  });

  const findSelectedTargetDevice = (target: ModulationTarget): GeneratorDeviceNode | null =>
    targetableDevices.find((item: GeneratorDeviceNode) => item.id === target.deviceId) ?? null;

  const resolveTargetParameterDefinition = (
    target: ModulationTarget,
  ): ModulationParameterDefinition | null => {
    const selectedTargetDevice = findSelectedTargetDevice(target);
    return selectedTargetDevice
      ? getRendererModulationTargetParamDefinitions(selectedTargetDevice.kind)
        .find((option) => option.key === target.paramKey) ?? null
      : null;
  };

  const resolveTargetLabel = (target: ModulationTarget): string => {
    const selectedTargetDevice = findSelectedTargetDevice(target);
    const deviceLabel = selectedTargetDevice
      ? deviceDisplayNameById[selectedTargetDevice.id] ?? getRendererDeviceLabel(selectedTargetDevice.kind)
      : 'Missing target';
    const paramLabel = resolveTargetParameterDefinition(target)?.label
      ?? target.paramKey;
    return `${deviceLabel} / ${paramLabel}`;
  };

  const resolveTargetUnit = (
    target: ModulationTarget,
  ): NumericParameterUnit | undefined =>
    resolveTargetParameterDefinition(target)?.unit;

  const clearTargetSlot = (slotIndex: number): void => {
    onControlChange({
      action: 'clear-modulation-target-slot',
      deviceId: device.id,
      value: slotIndex,
      finalize: true,
    });
  };

  const isTargetSlotActive = (slotIndex: number): boolean =>
    activeModulationTargetSlotIndex === slotIndex;

  const handleTargetSlotPointerDown = (event: PointerEvent): void => {
    event.stopPropagation();
  };

  const selectTargetSlot = (slotIndex: number): void => {
    onModulationTargetSlotSelect?.(slotIndex);
  };
</script>

<div class="device-controls modulation-layout">
  {#if activeTab === 'curve'}
    <div class="modulation-tab-panel modulation-curve-panel">
      <SelectField
        label="Divisions"
        value={device.params.curve.divisions}
        options={MODULATION_DIVISION_OPTIONS}
        dataAction="set-modulation-divisions"
        dataId={device.id}
        {onControlChange}
      />
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
  {:else}
    <div class="modulation-tab-panel modulation-map-panel">
      <div class="modulation-target-labels" aria-hidden="true">
        <div class="modulation-target-label-group">
          <span>Parameter</span>
          <span>Amount</span>
        </div>
        <div class="modulation-target-label-group">
          <span>Parameter</span>
          <span>Amount</span>
        </div>
      </div>
      <div class="modulation-target-list">
        {#each targetSlotRows as row, slotIndex (row.kind === 'target' ? row.target.id : row.id)}
          {@const isActiveTargetSlot = isTargetSlotActive(slotIndex)}
          <div
            class="modulation-target-row"
          >
            {#if row.kind === 'target'}
              {@const target = row.target}
              {@const targetLabel = resolveTargetLabel(target)}
              <ValueButton
                text={targetLabel}
                label={`Map target: ${targetLabel}`}
                pressed={isActiveTargetSlot}
                outlinePulse={isActiveTargetSlot}
                clearLabel="Clear mapping"
                clearTitle="Clear mapping"
                onPointerDown={handleTargetSlotPointerDown}
                onClick={() => selectTargetSlot(slotIndex)}
                onClear={() => clearTargetSlot(slotIndex)}
              />
              <NumberField
                label="Amount"
                size="compact"
                labelVisibility="hidden"
                fill={true}
                step="0.1"
                unit={resolveTargetUnit(target)}
                value={target.amount}
                dataAction="set-modulation-target-amount"
                dataId={device.id}
                dataParam={target.id}
                {onControlChange}
              />
            {:else}
              <ValueButton
                text=""
                label="Map target"
                placeholder="Map"
                pressed={isActiveTargetSlot}
                outlinePulse={isActiveTargetSlot}
                onPointerDown={handleTargetSlotPointerDown}
                onClick={() => selectTargetSlot(slotIndex)}
              />
              <div class="modulation-target-empty-amount" aria-hidden="true">1</div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style lang="scss">
  .modulation-tab-panel {
    display: flex;
    flex: 1 1 auto;
    gap: var(--gap-10);
    min-width: 0;
    min-height: 0;
  }

  .modulation-main {
    flex: 1 1 12rem;
    min-width: 12rem;
    min-height: 0;

    :global(.modulation-curve-control) {
      flex: 1 1 auto;
      min-height: 0;
    }
  }

  .modulation-map-panel {
    --modulation-target-group-width: 12.5rem;
    --modulation-target-amount-width: 2.75rem;

    display: flex;
    flex-direction: column;
    gap: var(--gap-6);
    height: 100%;
    overflow: hidden;
  }

  .modulation-target-labels {
    display: grid;
    grid-template-columns: repeat(2, var(--modulation-target-group-width));
    column-gap: var(--gap-10);
    flex: 0 0 auto;
    min-width: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-12);
    line-height: normal;
  }

  .modulation-target-label-group {
    display: grid;
    grid-template-columns: minmax(7.5rem, 1fr) var(--modulation-target-amount-width);
    gap: var(--gap-4);
    min-width: 0;
  }

  .modulation-target-list {
    display: grid;
    grid-auto-flow: column;
    grid-template-columns: repeat(2, var(--modulation-target-group-width));
    grid-template-rows: repeat(5, var(--gap-20));
    column-gap: var(--gap-10);
    row-gap: var(--gap-10);
    align-content: start;
    width: 100%;
    flex: 0 0 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .modulation-target-row {
    position: relative;
    display: grid;
    grid-template-columns: minmax(7.5rem, 1fr) var(--modulation-target-amount-width);
    gap: var(--gap-4);
    align-items: center;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    padding: 0;
    background: transparent;
    color: inherit;
    text-align: left;
  }

  .modulation-target-empty-amount {
    display: flex;
    align-items: center;
    width: 100%;
    min-width: 0;
    height: 100%;
    border-radius: var(--radius-4);
    background: var(--color-surface-interactive);
    color: var(--color-text-tertiary);
    font-size: var(--text-12);
    padding: 0 var(--gap-6);
  }
</style>
