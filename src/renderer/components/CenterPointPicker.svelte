<svelte:options runes={true} />

<script lang="ts">
  import { clamp } from '../../shared/math';

  let {
    deviceId,
    centerX,
    centerY,
  } = $props<{
    deviceId: string;
    centerX: number;
    centerY: number;
  }>();

  const MIN = 0;
  const MAX = 9;
  const STEP = 0.5;
  const RANGE = MAX - MIN;
  const MIDPOINT = (MIN + MAX) / 2;

  const resolvedCenterX = $derived(clamp(Math.round(centerX / STEP) * STEP, MIN, MAX));
  const resolvedCenterY = $derived(clamp(Math.round(centerY / STEP) * STEP, MIN, MAX));
  const xPercent = $derived((((resolvedCenterX - MIN) / RANGE) * 100).toFixed(3));
  const yPercent = $derived(((1 - (resolvedCenterY - MIN) / RANGE) * 100).toFixed(3));
  const isCenterX = $derived(Math.abs(resolvedCenterX - MIDPOINT) < 0.0001);
  const isCenterY = $derived(Math.abs(resolvedCenterY - MIDPOINT) < 0.0001);
  const gridStepPercent = $derived((100 / RANGE).toFixed(3));
  let surfaceHeight = $state(0);
</script>

<div class="center-point-control" role="group" aria-label="Center point picker">
  <span class="field-label">Center</span>
  <div
    class="center-picker-surface"
    bind:clientHeight={surfaceHeight}
    data-action="set-center-point"
    data-id={deviceId}
    data-min={MIN}
    data-max={MAX}
    data-step={STEP}
    data-center-x-state={isCenterX ? 'center' : 'off-center'}
    data-center-y-state={isCenterY ? 'center' : 'off-center'}
    aria-label="Center point area"
    style={`width:${surfaceHeight}px;--picker-x:${xPercent}%;--picker-y:${yPercent}%;--picker-grid-step:${gridStepPercent}%;`}
  ></div>
  <div class="center-picker-inputs">
    <div class="control-field">
      <span class="field-label">X</span>
      <input
        type="number"
        step={STEP}
        min={MIN}
        max={MAX}
        value={resolvedCenterX}
        data-action="set-center-picker-param"
        data-id={deviceId}
        data-param="centerX"
      />
    </div>
    <div class="control-field">
      <span class="field-label">Y</span>
      <input
        type="number"
        step={STEP}
        min={MIN}
        max={MAX}
        value={resolvedCenterY}
        data-action="set-center-picker-param"
        data-id={deviceId}
        data-param="centerY"
      />
    </div>
  </div>
</div>

<style lang="scss">
  .center-point-control {
    display: flex;
    flex-direction: column;
    gap: var(--gap-6);
  }

  .center-picker-surface {
    position: relative;
    flex: 1;
    border: 1px solid var(--neutral-30);
    border-radius: var(--radius-4);
    cursor: crosshair;
    --picker-guide-x-color: transparent;
    --picker-guide-y-color: transparent;
    background:
      linear-gradient(
        to bottom,
        var(--picker-guide-x-color),
        var(--picker-guide-x-color)
      ) var(--picker-x, 50%) 0 / 1px 100% no-repeat,
      linear-gradient(
        to right,
        var(--picker-guide-y-color),
        var(--picker-guide-y-color)
      ) 0 var(--picker-y, 50%) / 100% 1px no-repeat,
      repeating-linear-gradient(
        to right,
        var(--neutral-20) 0,
        var(--neutral-20) 1px,
        transparent 1px,
        transparent var(--picker-grid-step, 10%)
      ),
      repeating-linear-gradient(
        to bottom,
        var(--neutral-20) 0,
        var(--neutral-20) 1px,
        transparent 1px,
        transparent var(--picker-grid-step, 10%)
      ),
      var(--neutral-10);

    &:active {
      --picker-guide-x-color: var(--neutral-30);
      --picker-guide-y-color: var(--neutral-30);
    }
    &:active[data-center-x-state='center'] {
      --picker-guide-x-color: var(--accent-500);
    }

    &:active[data-center-y-state='center'] {
      --picker-guide-y-color: var(--accent-500);
    }

    &::after {
      content: '';
      position: absolute;
      left: var(--picker-x, 50%);
      top: var(--picker-y, 50%);
      width: 0.5rem;
      height: 0.5rem;
      border-radius: var(--radius-round);
      background: var(--accent-500);
      transform: translate(-50%, -50%);
    }
  }

  .center-picker-inputs {
    display: flex;
    gap: var(--gap-8);
    margin-top: var(--gap-2);

    .control-field {
      flex: 1 1 0;
      gap: var(--gap-4);
      flex-direction: row;
      align-items: center;
      
      input {
        flex: 1 1 0;
        width: auto;
        height: var(--gap-20);
        padding: 0 var(--gap-6);
        font-size: var(--text-12);
      }
    }
  }
</style>
