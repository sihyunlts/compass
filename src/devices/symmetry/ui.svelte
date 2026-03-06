<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import type { RendererDeviceEditorPropsBase } from '../types';

  type SymmetryDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'symmetry' }>;
  };

  let { device }: SymmetryDeviceEditorProps = $props();
</script>

<div class="device-controls">
  <div class="control-field">
    <span class="field-label">Mode</span>
    <select data-action="set-effect-symmetry-mode" data-id={device.id}>
      <option value="mirror-half" selected={device.params.mode === 'mirror-half'}>
        Half Mirror
      </option>
      <option value="quad-mirror" selected={device.params.mode === 'quad-mirror'}>
        Quad Mirror
      </option>
      <option value="quad-pinwheel" selected={device.params.mode === 'quad-pinwheel'}>
        Quad Pinwheel
      </option>
    </select>
  </div>
  <div class="control-field">
    <span class="field-label">Axis (Half Mode)</span>
    <select data-action="set-effect-symmetry-axis" data-id={device.id}>
      <option value="horizontal" selected={device.params.axis === 'horizontal'}>
        Horizontal
      </option>
      <option value="vertical" selected={device.params.axis === 'vertical'}>
        Vertical
      </option>
    </select>
  </div>
  <div class="control-field">
    <span class="field-label">Source Quadrant</span>
    <select data-action="set-effect-symmetry-anchor" data-id={device.id}>
      <option value="bl" selected={device.params.sourceAnchor === 'bl'}>
        Bottom Left
      </option>
      <option value="br" selected={device.params.sourceAnchor === 'br'}>
        Bottom Right
      </option>
      <option value="tr" selected={device.params.sourceAnchor === 'tr'}>
        Top Right
      </option>
      <option value="tl" selected={device.params.sourceAnchor === 'tl'}>
        Top Left
      </option>
    </select>
  </div>
</div>
