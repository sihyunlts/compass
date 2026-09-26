<svelte:options runes={true} />

<script lang="ts">
  import { COMPOSITION_CENTER } from '../../core/geometry';
  import { addDecimalStep } from '../../shared/math';
  import type { GeneratorDeviceNode } from '../../shared/model';
  import NumberField from '../../renderer/components/fields/NumberField.svelte';
  import FieldShell from '../../renderer/components/fields/FieldShell.svelte';
  import Button from '../../renderer/components/primitives/Button.svelte';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import { TRANSLATE_NUMERIC_PARAMETERS } from './schema';
  import { i18n } from '../../renderer/i18n.svelte';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';

  type TranslateDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'translate' }>;
  };

  let { device, modulationStateByParameter, onControlChange }: TranslateDeviceEditorProps = $props();
  const offsetIsDefault = $derived(
    device.params.offsetX === TRANSLATE_NUMERIC_PARAMETERS.offsetX.defaultValue
    && device.params.offsetY === TRANSLATE_NUMERIC_PARAMETERS.offsetY.defaultValue,
  );
  const upFill = $derived(Math.min(1, Math.max(0, device.params.offsetY) / COMPOSITION_CENTER.y));
  const leftFill = $derived(Math.min(1, Math.max(0, -device.params.offsetX) / COMPOSITION_CENTER.x));
  const rightFill = $derived(Math.min(1, Math.max(0, device.params.offsetX) / COMPOSITION_CENTER.x));
  const downFill = $derived(Math.min(1, Math.max(0, -device.params.offsetY) / COMPOSITION_CENTER.y));

  const moveByHalfStep = (axis: 'offsetX' | 'offsetY', direction: -1 | 1): void => {
    onControlChange({
      action: 'set-translate-param',
      deviceId: device.id,
      paramKey: axis,
      value: addDecimalStep(device.params[axis], direction * 0.5),
      finalize: true,
    });
  };

  const resetOffset = (): void => {
    onControlChange({
      action: 'reset-translate-offset',
      deviceId: device.id,
      value: null,
      finalize: true,
    });
  };
</script>

<DeviceBodyLayout kind="fields" size="regular">
  <FieldShell
    label={i18n.t('device.translate')}
    class="translate-controls"
    role="group"
    aria-label={i18n.t('device.translate')}
  >
    <div class="translate-inputs">
      <NumberField
        label="X"
        layout="inline"
        size="compact"
        fill={true}
        parameter={TRANSLATE_NUMERIC_PARAMETERS.offsetX}
        value={device.params.offsetX}
        dataAction="set-translate-param"
        dataId={device.id}
        dataParam="offsetX"
        ariaLabel={i18n.t('control.offsetX')}
        {modulationStateByParameter}
        {onControlChange}
      />
      <NumberField
        label="Y"
        layout="inline"
        size="compact"
        fill={true}
        parameter={TRANSLATE_NUMERIC_PARAMETERS.offsetY}
        value={device.params.offsetY}
        dataAction="set-translate-param"
        dataId={device.id}
        dataParam="offsetY"
        ariaLabel={i18n.t('control.offsetY')}
        {modulationStateByParameter}
        {onControlChange}
      />
    </div>
    <div class="translate-direction-pad">
      <div class="translate-pad-slot translate-up" style:--fill-ratio={upFill}>
        <Button
          variant="icon"
          icon="arrow_upward"
          label={i18n.t('control.translateUpHalf')}
          title=""
          onClick={() => moveByHalfStep('offsetY', 1)}
        />
      </div>
      <div class="translate-pad-slot translate-left" style:--fill-ratio={leftFill}>
        <Button
          variant="icon"
          icon="arrow_back"
          label={i18n.t('control.translateLeftHalf')}
          title=""
          onClick={() => moveByHalfStep('offsetX', -1)}
        />
      </div>
      <div class="translate-pad-slot translate-reset">
        <Button
          variant="icon"
          icon="restart_alt"
          label={i18n.t('control.translateReset')}
          title=""
          disabled={offsetIsDefault}
          onClick={resetOffset}
        />
      </div>
      <div class="translate-pad-slot translate-right" style:--fill-ratio={rightFill}>
        <Button
          variant="icon"
          icon="arrow_forward"
          label={i18n.t('control.translateRightHalf')}
          title=""
          onClick={() => moveByHalfStep('offsetX', 1)}
        />
      </div>
      <div class="translate-pad-slot translate-down" style:--fill-ratio={downFill}>
        <Button
          variant="icon"
          icon="arrow_downward"
          label={i18n.t('control.translateDownHalf')}
          title=""
          onClick={() => moveByHalfStep('offsetY', -1)}
        />
      </div>
    </div>
  </FieldShell>
</DeviceBodyLayout>

<style lang="scss">
  :global(.control-field.translate-controls) {
    --translate-button-size: 2rem;
    --translate-pad-width: calc(var(--translate-button-size) * 3 + var(--gap-4) * 2);

    align-self: stretch;
  }

  .translate-direction-pad {
    display: grid;
    grid-template-columns: repeat(3, var(--translate-button-size));
    grid-template-rows: repeat(3, var(--translate-button-size));
    gap: var(--gap-4);
    margin-top: auto;
  }

  .translate-pad-slot :global(.button) {
    position: relative;
    overflow: hidden;

    &::before {
      content: '';
      position: absolute;
      inset: 0;
      background: color-mix(
        in srgb,
        var(--device-control-accent, var(--color-surface-inverse)) 32%,
        transparent
      );
      transform: scaleX(var(--fill-ratio, 0));
      transform-origin: left;
      pointer-events: none;
    }
  }

  .translate-pad-slot :global(.button .material-symbols-rounded) {
    position: relative;
  }

  .translate-up {
    grid-column: 2;
    grid-row: 1;

    :global(.button)::before {
      transform: scaleY(var(--fill-ratio));
      transform-origin: bottom;
    }
  }

  .translate-left {
    grid-column: 1;
    grid-row: 2;

    :global(.button)::before {
      transform-origin: right;
    }
  }

  .translate-reset {
    grid-column: 2;
    grid-row: 2;

    :global(.button)::before {
      display: none;
    }
  }

  .translate-right {
    grid-column: 3;
    grid-row: 2;
  }

  .translate-down {
    grid-column: 2;
    grid-row: 3;

    :global(.button)::before {
      transform: scaleY(var(--fill-ratio));
      transform-origin: top;
    }
  }

  .translate-inputs {
    display: flex;
    gap: var(--gap-4);
    inline-size: var(--translate-pad-width);
  }
</style>
