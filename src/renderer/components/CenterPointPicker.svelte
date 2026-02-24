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

  const resolvedCenterX = $derived(clamp(Math.round(centerX / STEP) * STEP, MIN, MAX));
  const resolvedCenterY = $derived(clamp(Math.round(centerY / STEP) * STEP, MIN, MAX));
  const xPercent = $derived((((resolvedCenterX - MIN) / RANGE) * 100).toFixed(3));
  const yPercent = $derived(((1 - (resolvedCenterY - MIN) / RANGE) * 100).toFixed(3));
</script>

<div class="center-point-control">
  <span class="field-label">Center (0.5 Snap)</span>
  <div class="center-picker" role="group" aria-label="Center point picker">
    <div
      class="center-picker-surface"
      data-action="set-center-point"
      data-id={deviceId}
      data-min={MIN}
      data-max={MAX}
      data-step={STEP}
      data-center-x={resolvedCenterX.toFixed(1)}
      data-center-y={resolvedCenterY.toFixed(1)}
      aria-label="Center point area"
      style={`--picker-x:${xPercent}%;--picker-y:${yPercent}%;`}
    ></div>
    <span class="center-picker-readout">
      X {resolvedCenterX.toFixed(1)} | Y {resolvedCenterY.toFixed(1)}
    </span>
  </div>
</div>

<style lang="scss">
  .center-point-control {
    display: flex;
    flex-direction: column;
    gap: var(--gap-6);
    min-height: 0;
    height: 100%;
  }

  .center-picker {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: var(--gap-6);
    min-height: 0;
    height: 100%;
    min-width: 0;

    &-surface {
      position: relative;
      height: 100%;
      min-width: 0;
      max-height: 100%;
      max-width: 100%;
      min-height: 0;
      aspect-ratio: 1 / 1;
      border: 1px solid var(--neutral-30);
      border-radius: var(--radius-6);
      cursor: crosshair;
      background:
        repeating-linear-gradient(
          to right,
          rgb(var(--rgb-white) / var(--alpha-02)) 0,
          rgb(var(--rgb-white) / var(--alpha-02)) 1px,
          transparent 1px,
          transparent 10%
        ),
        repeating-linear-gradient(
          to bottom,
          rgb(var(--rgb-white) / var(--alpha-02)) 0,
          rgb(var(--rgb-white) / var(--alpha-02)) 1px,
          transparent 1px,
          transparent 10%
        ),
        var(--neutral-10);

      &::before {
        content: '';
        position: absolute;
        left: var(--picker-x, 50%);
        top: 0;
        bottom: 0;
        width: 1px;
        background: rgb(var(--rgb-white) / var(--alpha-08));
        transform: translateX(-50%);
      }

      &::after {
        content: '';
        position: absolute;
        left: var(--picker-x, 50%);
        top: var(--picker-y, 50%);
        width: 0.48rem;
        height: 0.48rem;
        border-radius: var(--radius-round);
        background: var(--accent-500);
        box-shadow: 0 0 0 1px rgb(var(--rgb-black) / var(--alpha-15));
        transform: translate(-50%, -50%);
      }
    }

    &-readout {
      color: var(--neutral-50);
      font-size: var(--text-12);
    }
  }
</style>
