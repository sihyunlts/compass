<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import SelectField from '../../renderer/components/fields/SelectField.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';

  const SYMMETRY_MODE_OPTIONS = [
    { value: 'mirror-half', label: 'Half Mirror' },
    { value: 'quad-mirror', label: 'Quad Mirror' },
    { value: 'quad-pinwheel', label: 'Quad Pinwheel' },
  ] as const;

  const SYMMETRY_AXIS_OPTIONS = [
    { value: 'horizontal', label: 'Horizontal' },
    { value: 'vertical', label: 'Vertical' },
  ] as const;

  const SYMMETRY_ANCHOR_OPTIONS = [
    { value: 'bl', label: 'Bottom Left' },
    { value: 'br', label: 'Bottom Right' },
    { value: 'tr', label: 'Top Right' },
    { value: 'tl', label: 'Top Left' },
  ] as const;

  type SymmetryDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'symmetry' }>;
  };

  let { device }: SymmetryDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <SelectField
    label="Mode"
    value={device.params.mode}
    options={SYMMETRY_MODE_OPTIONS}
    dataAction="set-effect-symmetry-mode"
    dataId={device.id}
  />
  <SelectField
    label="Axis (Half Mode)"
    value={device.params.axis}
    options={SYMMETRY_AXIS_OPTIONS}
    dataAction="set-effect-symmetry-axis"
    dataId={device.id}
  />
  <SelectField
    label="Source Quadrant"
    value={device.params.sourceAnchor}
    options={SYMMETRY_ANCHOR_OPTIONS}
    dataAction="set-effect-symmetry-anchor"
    dataId={device.id}
  />
</div>
