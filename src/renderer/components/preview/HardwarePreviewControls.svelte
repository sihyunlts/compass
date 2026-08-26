<script lang="ts">
  import type { MessageKey } from '../../../shared/i18n';
  import type {
    HardwareMidiError,
    HardwareMidiOutput,
  } from '../../../shared/contracts/preview/hardware-output';
  import { i18n } from '../../i18n.svelte';
  import DropdownSelect from '../primitives/DropdownSelect.svelte';
  import type { DropdownOption, DropdownValue } from '../primitives/dropdown-types';

  let {
    outputs,
    selectedOutputId,
    isAccessing,
    error,
    onRefreshOutputs,
    onSelectOutput,
  } = $props<{
    outputs: HardwareMidiOutput[];
    selectedOutputId: string | null;
    isAccessing: boolean;
    error: HardwareMidiError | null;
    onRefreshOutputs: () => void | Promise<void>;
    onSelectOutput: (outputId: string | null) => void | Promise<void>;
  }>();

  const STATUS_OPTION_VALUE = '__hardware-midi-status__';
  const ERROR_MESSAGE_KEYS: Record<HardwareMidiError, MessageKey> = {
    'unsupported': 'preview.hardware.error.unsupported',
    'access-denied': 'preview.hardware.error.access-denied',
    'output-open-failed': 'preview.hardware.error.output-open-failed',
    'output-disconnected': 'preview.hardware.error.output-disconnected',
    'output-failed': 'preview.hardware.error.output-failed',
  };

  const selectedOutput = $derived(
    outputs.find((output: HardwareMidiOutput) => output.id === selectedOutputId) ?? null,
  );
  const resolveErrorLabel = (value: HardwareMidiError | null): string | null =>
    value ? i18n.t(ERROR_MESSAGE_KEYS[value]) : null;
  const errorLabel = $derived(resolveErrorLabel(error));
  const outputLabel = $derived(
    errorLabel ?? (selectedOutput
      ? selectedOutput.name
      : i18n.t('preview.hardware.outputLabel')),
  );
  const options = $derived.by((): DropdownOption[] => {
    const noOutputOption: DropdownOption = {
      value: '',
      label: i18n.t('preview.hardware.noOutput'),
    };
    if (isAccessing) {
      return [noOutputOption, {
        value: STATUS_OPTION_VALUE,
        label: i18n.t('preview.hardware.loadingOutputs'),
        disabled: true,
      }];
    }
    if (error && outputs.length === 0) {
      return [noOutputOption, {
        value: STATUS_OPTION_VALUE,
        label: errorLabel ?? i18n.t('preview.hardware.noOutputs'),
        disabled: true,
      }];
    }
    if (outputs.length === 0) {
      return [noOutputOption, {
        value: STATUS_OPTION_VALUE,
        label: i18n.t('preview.hardware.noOutputs'),
        disabled: true,
      }];
    }
    return [
      noOutputOption,
      ...outputs.map((output: HardwareMidiOutput) => ({
        value: output.id,
        label: output.name,
      })),
    ];
  });

  const handleSelect = (value: DropdownValue): void => {
    if (value !== STATUS_OPTION_VALUE) {
      void onSelectOutput(value === '' ? null : String(value));
    }
  };
</script>

<div class="hardware-preview-controls">
  <DropdownSelect
    id="hardware-preview-output"
    variant="icon"
    icon="cable"
    value={selectedOutputId ?? ''}
    {options}
    valueLabel={outputLabel}
    ariaLabel={outputLabel}
    heading={i18n.t('preview.hardware.outputLabel')}
    pressed={selectedOutputId !== null}
    showHint
    onOpen={onRefreshOutputs}
    onValueChange={handleSelect}
  />
</div>

<style lang="scss">
  .hardware-preview-controls {
    display: flex;
    margin-top: auto;
  }
</style>
