<svelte:options runes={true} />

<script lang="ts">
  import { clamp } from '../../../shared/math';
  import type { ModulationParameterState } from '../../../shared/contracts/preview/modulation';
  import { i18n } from '../../i18n.svelte';
  import type { ModulationDisplayDomain } from './modulation-display-domain';

  let {
    states,
    domain,
  } = $props<{
    states: readonly ModulationParameterState[];
    domain: ModulationDisplayDomain;
  }>();

  const finiteStates = $derived(states.filter((state: ModulationParameterState) => (
    Number.isFinite(state.baseValue)
    && Number.isFinite(state.amount)
    && Number.isFinite(state.modulatedValue)
  )));

  const domainSpan = $derived(
    domain.kind === 'open'
      ? domain.softSpan
      : Math.max(domain.max - domain.min, 0.000001),
  );

  const toCircularPercent = (value: number): number => {
    if (domain.kind !== 'circular') {
      return 0;
    }
    let wrapped = (value - domain.min) % domainSpan;
    if (wrapped < 0) {
      wrapped += domainSpan;
    }
    return (wrapped / domainSpan) * 100;
  };

  const circularRangePoint = (percent: number): { x: number; y: number } => {
    const radians = percent * 3.6 * Math.PI / 180;
    return {
      x: 50 + 46 * Math.cos(radians),
      y: 50 + 46 * Math.sin(radians),
    };
  };

  const circularArcPath = (startPercent: number, width: number): string => {
    const start = circularRangePoint(startPercent);
    const end = circularRangePoint(startPercent + width);
    return [
      `M ${start.x.toFixed(3)} ${start.y.toFixed(3)}`,
      `A 46 46 0 ${width > 50 ? 1 : 0} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`,
    ].join(' ');
  };

  const resolveCircularRange = (
    state: ModulationParameterState,
  ): { fullCircle: boolean; path: string | null } => {
    if (domain.kind !== 'circular') {
      return { fullCircle: false, path: null };
    }

    const amount = Math.abs(state.amount);
    const width = Math.min((amount * 2 / domainSpan) * 100, 100);
    if (width >= 100) {
      return { fullCircle: true, path: null };
    }
    if (width <= 0) {
      return { fullCircle: false, path: null };
    }

    const startPercent = toCircularPercent(state.baseValue - amount);
    return {
      fullCircle: false,
      path: circularArcPath(startPercent, width),
    };
  };

  const resolveCircularCurrentPath = (
    state: ModulationParameterState,
  ): string | null => {
    if (domain.kind !== 'circular') {
      return null;
    }

    const amount = Math.abs(state.amount);
    const rangeWidth = Math.min((amount * 2 / domainSpan) * 100, 100);
    if (rangeWidth <= 0) {
      return null;
    }

    const rangeStart = toCircularPercent(state.baseValue - amount);
    const currentPercent = toCircularPercent(state.modulatedValue);
    const currentOffset = (currentPercent - rangeStart + 100) % 100;
    const halfPathWidth = 1.45;
    if (rangeWidth >= 100) {
      return circularArcPath(currentPercent - halfPathWidth, halfPathWidth * 2);
    }

    const visibleStart = Math.max(0, currentOffset - halfPathWidth);
    const visibleEnd = Math.min(rangeWidth, currentOffset + halfPathWidth);
    if (visibleEnd <= visibleStart) {
      return null;
    }

    return circularArcPath(rangeStart + visibleStart, visibleEnd - visibleStart);
  };

  const toLinearPercent = (
    state: ModulationParameterState,
    value: number,
  ): number => {
    if (domain.kind === 'bounded') {
      return clamp(((value - domain.min) / domainSpan) * 100, 0, 100);
    }
    if (domain.kind === 'open') {
      return clamp(
        50 + ((value - state.baseValue) / domain.softSpan) * 50,
        0,
        100,
      );
    }
    return toCircularPercent(value);
  };

  const resolveLinearRange = (
    state: ModulationParameterState,
  ): { left: number; width: number } => {
    const amount = Math.abs(state.amount);
    const start = toLinearPercent(state, state.baseValue - amount);
    const end = toLinearPercent(state, state.baseValue + amount);
    return {
      left: Math.min(start, end),
      width: Math.abs(end - start),
    };
  };

</script>

{#if finiteStates.length > 0}
  <div
    class="modulation-indicator"
    class:is-linear={domain.kind !== 'circular'}
    class:is-circular={domain.kind === 'circular'}
    class:is-open={domain.kind === 'open'}
    role="img"
    aria-label={i18n.t('modulation.connected')}
  >
    {#if domain.kind === 'circular'}
      <svg class="modulation-ring" viewBox="0 0 100 100" aria-hidden="true">
        {#each finiteStates as state (`${state.modulatorId}:${state.targetId}`)}
          {@const range = resolveCircularRange(state)}
          {#if range.fullCircle}
            <circle
              class="modulation-ring-range"
              cx="50"
              cy="50"
              r="46"
            ></circle>
          {:else if range.path}
            <path class="modulation-ring-range" d={range.path}></path>
          {/if}
        {/each}
        {#each finiteStates as state (`${state.modulatorId}:${state.targetId}`)}
          {@const currentPath = resolveCircularCurrentPath(state)}
          {#if currentPath}
            <path class="modulation-ring-current" d={currentPath}></path>
          {/if}
        {/each}
      </svg>
    {:else}
      {#each finiteStates as state (`${state.modulatorId}:${state.targetId}`)}
        {@const basePercent = toLinearPercent(state, state.baseValue)}
        {@const currentPercent = toLinearPercent(state, state.modulatedValue)}
        {@const range = resolveLinearRange(state)}
        <span
          class="modulation-linear-state"
          style={`clip-path:inset(0 ${100 - range.left - range.width}% 0 ${range.left}%);`}
        >
          <span
            class="modulation-linear-range"
            style={`left:${range.left}%;width:${range.width}%;`}
          ></span>
          <span
            class="modulation-linear-base"
            style={`--modulation-base-position:${basePercent}%;`}
          ></span>
          <span
            class="modulation-linear-current"
            style={`--modulation-current-position:${currentPercent}%;`}
          ></span>
        </span>
      {/each}
    {/if}
  </div>
{/if}

<style lang="scss">
  .modulation-indicator {
    --modulation-line-thickness: var(--gap-2);
    --modulation-base-indicator-width: calc(var(--gap-2) / 2);
    --modulation-current-indicator-width: var(--gap-6);
    --modulation-current-indicator-height: var(--gap-2);
    --modulation-indicator-accent: var(
      --device-control-accent,
      var(--color-category-utility)
    );

    position: absolute;
    pointer-events: none;

    &.is-linear {
      right: 0;
      bottom: 0;
      left: 0;
      height: var(--modulation-line-thickness);
      overflow: hidden;
    }

    &.is-open::before {
      content: '';
      position: absolute;
      top: 50%;
      right: 0;
      left: 0;
      height: var(--modulation-line-thickness);
      transform: translateY(-50%);
      background: linear-gradient(
        90deg,
        transparent,
        var(--color-border-secondary) 22%,
        var(--color-border-secondary) 78%,
        transparent
      );
    }

    &.is-circular {
      inset: var(--gap-neg-4);
      border-radius: var(--radius-round);
    }
  }

  .modulation-linear-state,
  .modulation-linear-range,
  .modulation-linear-base,
  .modulation-linear-current {
    position: absolute;
    display: block;
  }

  .modulation-linear-state {
    inset: 0;
  }

  .modulation-linear-range {
    top: 50%;
    height: var(--modulation-line-thickness);
    min-width: calc(var(--gap-2) / 2);
    transform: translateY(-50%);
    border-radius: var(--radius-round);
    background: color-mix(
      in oklch,
      var(--modulation-indicator-accent) 40%,
      transparent
    );
  }

  .modulation-linear-base {
    top: 0;
    left: var(--modulation-base-position);
    width: var(--modulation-base-indicator-width);
    height: 100%;
    transform: translateX(-50%);
    background: var(--color-overlay-highlight-primary);
  }

  .modulation-linear-current {
    top: 50%;
    left: var(--modulation-current-position);
    width: var(--modulation-current-indicator-width);
    height: var(--modulation-current-indicator-height);
    transform: translate(-50%, -50%);
    border-radius: var(--radius-round);
    background: var(--modulation-indicator-accent);
  }

  .modulation-ring {
    width: 100%;
    height: 100%;
    overflow: visible;
    transform: rotate(-90deg);
  }

  .modulation-ring-range {
    fill: none;
    stroke: color-mix(
      in oklch,
      var(--modulation-indicator-accent) 40%,
      transparent
    );
    stroke-width: 5;
    stroke-linecap: round;
  }

  .modulation-ring-current {
    fill: none;
    stroke: var(--modulation-indicator-accent);
    stroke-width: 4.167;
    stroke-linecap: round;
  }
</style>
