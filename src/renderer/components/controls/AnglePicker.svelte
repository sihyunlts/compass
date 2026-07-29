<svelte:options runes={true} />

<script lang="ts">
  import { onMount } from 'svelte';
  import type { RendererControlChange } from '../../../devices/control-types';
  import {
    formatNumericParameterDisplayValue,
    formatNumericParameterValue,
    normalizeNumericParameterValue,
    type NumericParameterRule,
  } from '../../../devices/numeric-parameters';
  import FieldShell from '../fields/FieldShell.svelte';

  let {
    label,
    value,
    dataAction,
    dataId,
    dataParam,
    parameter,
    min,
    max,
    step,
    onControlChange,
  } = $props<{
    label: string;
    value: number;
    dataAction: string;
    dataId: string;
    dataParam: string;
    parameter?: NumericParameterRule;
    min?: number;
    max?: number;
    step?: number;
    onControlChange: (change: RendererControlChange) => void;
  }>();

  const resolvedMin = $derived(min ?? parameter?.input.min);
  const resolvedMax = $derived(max ?? parameter?.input.max);
  const resolvedStep = $derived(step ?? parameter?.input.step ?? 1);
  const resolvedUnit = $derived(parameter?.display.unit);
  const dialMin = $derived(resolvedMin ?? 0);
  const dialMax = $derived(resolvedMax ?? 360);
  const valueSpan = $derived(Math.max(dialMax - dialMin, 0));
  const hasFiniteRange = $derived(
    resolvedMin !== undefined
    && resolvedMax !== undefined
    && resolvedMax > resolvedMin,
  );

  const numberLabel = $derived(`${label} input`);
  const dialLabel = $derived(`${label} dial`);

  let dialEl = $state<HTMLElement | null>(null);
  let dialInputEl = $state<HTMLInputElement | null>(null);
  let activePointerId = $state<number | null>(null);
  let lastPointerX = $state(0);
  let lastPointerY = $state(0);
  let dragRawValue = $state(0);
  let isPointerLocked = $state(false);

  const stepDecimals = $derived.by(() => {
    const stepText = String(resolvedStep);
    const dotIndex = stepText.indexOf('.');
    if (dotIndex < 0) {
      return 0;
    }
    return Math.max(0, stepText.length - dotIndex - 1);
  });

  const dialValue = $derived.by(() => {
    if (valueSpan <= 0) {
      return dialMin;
    }
    let wrapped = (value - dialMin) % valueSpan;
    if (wrapped < 0) {
      wrapped += valueSpan;
    }
    return dialMin + wrapped;
  });
  const ratio = $derived(
    (dialValue - dialMin) / Math.max(valueSpan, 0.000001),
  );
  const dialDeg = $derived(ratio * 360);
  const valueText = $derived(
    stepDecimals > 0 ? value.toFixed(stepDecimals) : String(Math.round(value)),
  );
  const accessibleValueText = $derived(
    parameter
      ? formatNumericParameterDisplayValue(parameter, value, valueText)
      : formatNumericParameterValue(valueText, resolvedUnit),
  );
  const dragSensitivity = $derived(
    hasFiniteRange
      ? Math.max(((resolvedMax as number) - (resolvedMin as number)) / 480, resolvedStep)
      : resolvedStep,
  );
  const canUsePointerLock = $derived(Boolean(dialEl && 'requestPointerLock' in dialEl));

  const formatValue = (nextValue: number): string =>
    stepDecimals > 0 ? nextValue.toFixed(stepDecimals) : String(Math.round(nextValue));

  const normalizeDialValue = (rawValue: number): number => {
    const stepOrigin = resolvedMin ?? 0;
    const stepped = Math.round((rawValue - stepOrigin) / resolvedStep)
      * resolvedStep + stepOrigin;

    if (parameter) {
      return normalizeNumericParameterValue(
        parameter,
        stepped,
        {},
        { step: resolvedStep },
      ) ?? value;
    }

    if (valueSpan <= 0) {
      return Number(stepped.toFixed(stepDecimals));
    }

    let wrapped = (stepped - dialMin) % valueSpan;
    if (wrapped < 0) {
      wrapped += valueSpan;
    }
    return Number((dialMin + wrapped).toFixed(stepDecimals));
  };

  const emitDialInput = (nextValue: number): void => {
    if (!dialInputEl) {
      return;
    }

    const nextText = formatValue(nextValue);
    if (dialInputEl.value === nextText) {
      return;
    }

    dialInputEl.value = nextText;
    dialInputEl.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const emitControlChange = (event: Event, finalize: boolean): void => {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    onControlChange({
      action: dataAction,
      deviceId: dataId,
      paramKey: dataParam,
      value: input.value,
      finalize,
      step: Number(input.step),
    });
  };

  const applyDragDelta = (deltaX: number, deltaY: number): void => {
    if (activePointerId === null) {
      return;
    }
    dragRawValue += (deltaY + deltaX * 0.5) * dragSensitivity;
    emitDialInput(normalizeDialValue(dragRawValue));
  };

  const requestDialPointerLock = (): void => {
    if (!dialEl || !canUsePointerLock) {
      return;
    }
    try {
      dialEl.requestPointerLock();
    } catch {
      // If pointer lock fails, regular drag behavior still works.
    }
  };

  const exitDialPointerLock = (): void => {
    if (document.pointerLockElement !== dialEl) {
      return;
    }
    document.exitPointerLock();
  };

  const handleDialPointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }

    if (!dialEl) {
      return;
    }

    activePointerId = event.pointerId;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    dragRawValue = value;
    dialEl.setPointerCapture(event.pointerId);
    if (event.pointerType === 'mouse') {
      requestDialPointerLock();
    }
    event.preventDefault();
  };

  const handleDialPointerMove = (event: PointerEvent): void => {
    if (activePointerId !== event.pointerId) {
      return;
    }
    if (isPointerLocked) {
      return;
    }

    const deltaY = lastPointerY - event.clientY;
    const deltaX = event.clientX - lastPointerX;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    applyDragDelta(deltaX, deltaY);
  };

  const clearDialPointer = (): void => {
    activePointerId = null;
    isPointerLocked = false;
    exitDialPointerLock();
  };

  const handleDialPointerUp = (event: PointerEvent): void => {
    if (activePointerId !== event.pointerId) {
      return;
    }
    clearDialPointer();
  };

  const handleDialPointerCancel = (event: PointerEvent): void => {
    if (activePointerId !== event.pointerId) {
      return;
    }
    clearDialPointer();
  };

  onMount(() => {
    const handlePointerLockChange = (): void => {
      const locked = document.pointerLockElement === dialEl;
      isPointerLocked = locked;
      if (!locked && activePointerId !== null) {
        activePointerId = null;
      }
    };

    const handleLockedMouseMove = (event: MouseEvent): void => {
      if (!isPointerLocked || activePointerId === null) {
        return;
      }
      applyDragDelta(event.movementX, -event.movementY);
    };

    const handleWindowMouseUp = (): void => {
      if (activePointerId === null) {
        return;
      }
      clearDialPointer();
    };

    document.addEventListener('pointerlockchange', handlePointerLockChange);
    document.addEventListener('mousemove', handleLockedMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('blur', handleWindowMouseUp);

    return () => {
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      document.removeEventListener('mousemove', handleLockedMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('blur', handleWindowMouseUp);
      clearDialPointer();
    };
  });
</script>

<FieldShell {label} class="angle-picker">
  <div class="angle-picker-controls">
    <div
      bind:this={dialEl}
      class="angle-picker-dial"
      role="slider"
      tabindex="0"
      aria-label={dialLabel}
      aria-valuemin={resolvedMin}
      aria-valuemax={resolvedMax}
      aria-valuenow={value}
      aria-valuetext={accessibleValueText}
      onpointerdown={handleDialPointerDown}
      onpointermove={handleDialPointerMove}
      onpointerup={handleDialPointerUp}
      onpointercancel={handleDialPointerCancel}
      style={`--angle-deg:${dialDeg.toFixed(3)}deg;`}
    >
      <div class="angle-picker-dial-ring"></div>
      <div class="angle-picker-dial-knob"></div>
    </div>
    <input
      bind:this={dialInputEl}
      class="angle-picker-dial-input"
      type="number"
      min={resolvedMin}
      max={resolvedMax}
      step={resolvedStep}
      value={value}
      aria-hidden="true"
      tabindex="-1"
      oninput={(event) => emitControlChange(event, false)}
      onchange={(event) => emitControlChange(event, true)}
    />
    <input
      class="angle-picker-number-input"
      class:has-display-unit={resolvedUnit !== undefined}
      type="number"
      min={resolvedMin}
      max={resolvedMax}
      step={resolvedStep}
      value={value}
      data-control-action={dataAction}
      data-device-id={dataId}
      data-param={dataParam}
      data-drag-mode={parameter?.input.dragMode}
      aria-label={numberLabel}
      oninput={(event: Event) => emitControlChange(event, false)}
      onchange={(event: Event) => emitControlChange(event, true)}
    />
    {#if resolvedUnit}
      <span
        class="numeric-value-display angle-picker-display-value"
        aria-hidden="true"
      >
        {accessibleValueText}
      </span>
    {/if}
  </div>
</FieldShell>

<style lang="scss">
  .angle-picker-controls {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--gap-8);
    min-width: 0;
  }

  .angle-picker-dial {
    position: relative;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: var(--radius-round);
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    cursor: n-resize;
    touch-action: none;
    background-color: var(--color-surface-interactive);

    &-ring {
      position: absolute;
      inset: 0;
      border-radius: var(--radius-round);
    }

    &-knob {
      position: absolute;
      width: 0.5rem;
      height: 0.5rem;
      border-radius: var(--radius-round);
      background: var(--device-control-accent, var(--color-surface-inverse));
      transform: rotate(var(--angle-deg)) translateY(-0.75rem);
    }

    &:focus-visible {
      outline: 2px solid var(--device-control-accent, var(--color-surface-inverse));
      outline-offset: 2px;
    }
  }

  .angle-picker-dial-input {
    display: none;
  }

  .angle-picker-number-input {
    width: 4.8rem;
    height: 1.75rem;
    flex: 0 0 auto;
  }

  .angle-picker-display-value {
    position: absolute;
    right: 0;
    top: 50%;
    width: 4.8rem;
    transform: translateY(-50%);
  }
</style>
