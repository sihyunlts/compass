<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import SelectField from '../../renderer/components/fields/SelectField.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { i18n } from '../../renderer/i18n.svelte';

  type SymmetryDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'symmetry' }>;
  };

  let { device, onControlChange }: SymmetryDeviceEditorProps = $props();

  const symmetryModeOptions = $derived([
    { value: 'mirror-half', label: i18n.t('option.halfMirror') },
    { value: 'quad-mirror', label: i18n.t('option.quadMirror') },
    { value: 'quad-pinwheel', label: i18n.t('option.quadPinwheel') },
  ]);
  const symmetryAxisOptions = $derived([
    { value: 'horizontal', label: i18n.t('option.horizontal') },
    { value: 'vertical', label: i18n.t('option.vertical') },
  ]);
  const symmetryAnchorOptions = $derived([
    { value: 'bl', label: i18n.t('option.bottomLeft') },
    { value: 'br', label: i18n.t('option.bottomRight') },
    { value: 'tr', label: i18n.t('option.topRight') },
    { value: 'tl', label: i18n.t('option.topLeft') },
  ]);
</script>

<div class="device-controls">
  <div class="column-wrapper">
    <SelectField
      label={i18n.t('control.mode')}
      value={device.params.mode}
      options={symmetryModeOptions}
      dataAction="set-effect-symmetry-mode"
      dataId={device.id}
      {onControlChange}
    />
    <SelectField
      label={i18n.t('control.axisHalfMode')}
      value={device.params.axis}
      options={symmetryAxisOptions}
      dataAction="set-effect-symmetry-axis"
      dataId={device.id}
      {onControlChange}
    />
    <SelectField
      label={i18n.t('control.sourceQuadrant')}
      value={device.params.sourceAnchor}
      options={symmetryAnchorOptions}
      dataAction="set-effect-symmetry-anchor"
      dataId={device.id}
      {onControlChange}
    />
  </div>
</div>
