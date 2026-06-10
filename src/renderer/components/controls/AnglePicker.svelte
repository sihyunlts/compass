<svelte:options runes={true} />

<script lang="ts">
  import { onMount } from 'svelte';
  import { clamp } from '../../../shared/math';
  import FieldShell from '../fields/FieldShell.svelte';

  let {
    label,
    value,
    dataAction,
    dataId,
    dataParam,
    min = 0,
    max = 360,
    step = 1,
  } = $props<{
    label: string;
    value: number;
    dataAction: string;
    dataId: string;
    dataParam: string;
    min?: number;
    max?: number;
    step?: number;
  }>();

  const sliderLabel = $derived(`${label} slider`);
  const numberLabel = $derived(`${label} input`);
  const dialLabel = $derived(`${label} dial`);

  let dialEl = $state<HTMLElement | null>(null);
  let sliderEl = $state<HTMLInputElement | null>(null);
  let activePointerId = $state<number | null>(null);
  let lastPointerX = $state(0);
  let lastPointerY = $state(0);
  let dragRawValue = $state(0);
  let isPointerLocked = $state(false);

  const stepDecimals = $derived.by(() => {
    const stepText = String(step);
    const dotIndex = stepText.indexOf('.');
    if (dotIndex < 0) {
      return 0;
    }
    return Math.max(0, stepText.length - dotIndex - 1);
  });

  const normalizedValue = $derived(clamp(value, min, max));
  const valueSpan = $derived(Math.max(max - min, 0));
  const ratio = $derived((normalizedValue - min) / Math.max(max - min, 0.000001));
  const dialDeg = $derived(ratio * 360);
  const valueText = $derived(
    stepDecimals > 0 ? normalizedValue.toFixed(stepDecimals) : String(Math.round(normalizedValue)),
  );
  const dragSensitivity = $derived(Math.max((max - min) / 480, step));
  const canUsePointerLock = $derived(Boolean(dialEl && 'requestPointerLock' in dialEl));

  const formatValue = (nextValue: number): string =>
    stepDecimals > 0 ? nextValue.toFixed(stepDecimals) : String(Math.round(nextValue));

  const snapCircularValue = (rawValue: number): number => {
    if (valueSpan <= 0) {
      return min;
    }

    const stepped = Math.round((rawValue - min) / step) * step + min;
    let wrapped = (stepped - min) % valueSpan;
    if (wrapped < 0) {
      wrapped += valueSpan;
    }
    return Number((min + wrapped).toFixed(stepDecimals));
  };

  const emitDialInput = (nextValue: number): void => {
    if (!sliderEl) {
      return;
    }

    const nextText = formatValue(nextValue);
    if (sliderEl.value === nextText) {
      return;
    }

    sliderEl.value = nextText;
    sliderEl.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const applyDragDelta = (deltaX: number, deltaY: number): void => {
    if (activePointerId === null) {
      return;
    }
    dragRawValue += (deltaY + deltaX * 0.5) * dragSensitivity;
    emitDialInput(snapCircularValue(dragRawValue));
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
    dragRawValue = normalizedValue;
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
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={normalizedValue}
      aria-valuetext={valueText}
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
      bind:this={sliderEl}
      class="angle-picker-slider-input"
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      data-action={dataAction}
      data-id={dataId}
      data-param={dataParam}
      aria-label={sliderLabel}
    />
    <input
      class="angle-picker-number-input"
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      data-action={dataAction}
      data-id={dataId}
      data-param={dataParam}
      aria-label={numberLabel}
    />
  </div>
</FieldShell>

<style lang="scss">
  .angle-picker-controls {
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
    background-color: var(--neutral-20);

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
      background: var(--device-control-accent, var(--accent-500));
      transform: rotate(var(--angle-deg)) translateY(-0.75rem);
    }

    &:focus-visible {
      outline: 2px solid var(--device-control-accent, var(--accent-500));
      outline-offset: 2px;
    }
  }

  .angle-picker-slider-input {
    display: none;
  }

  .angle-picker-number-input {
    width: 4.8rem;
    height: 1.75rem;
    flex: 0 0 auto;
  }
</style>
