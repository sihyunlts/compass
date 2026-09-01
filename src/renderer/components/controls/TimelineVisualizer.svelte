<svelte:options runes={true} />

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { clamp } from '../../../shared/math';

  let {
    playheadProgress01,
    rulerGap = 'regular',
    label,
    children,
  } = $props<{
    playheadProgress01?: number | null;
    rulerGap?: 'compact' | 'regular';
    label?: string;
    children: Snippet;
  }>();

  const showsPlayhead = $derived(
    playheadProgress01 !== undefined && playheadProgress01 !== null,
  );
  const playheadPercent = $derived(
    clamp(Number.isFinite(playheadProgress01) ? playheadProgress01 ?? 0 : 0, 0, 1) * 100,
  );
</script>

<div
  class="timeline-visualizer"
  data-ruler-gap={rulerGap}
  role={label ? 'img' : undefined}
  aria-label={label}
>
  <div class="timeline-ruler" aria-hidden="true">
    <span>0</span>
    <span>0.5</span>
    <span>1</span>
  </div>
  <div class="timeline-track" aria-hidden="true">
    {@render children()}
    {#if showsPlayhead}
      <span class="timeline-playhead" style={`left:${playheadPercent}%;`}></span>
    {/if}
  </div>
</div>

<style lang="scss">
  .timeline-visualizer {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;

    &[data-ruler-gap='compact'] {
      gap: var(--gap-6);
    }

    &[data-ruler-gap='regular'] {
      gap: var(--gap-8);
    }
  }

  .timeline-ruler {
    display: flex;
    justify-content: space-between;
    color: var(--color-text-secondary);
    font-size: var(--text-12);
  }

  .timeline-track {
    position: relative;
    height: 1.75rem;
    overflow: hidden;
    border-radius: var(--radius-4);
    background: var(--color-surface-interactive);
  }

  .timeline-playhead {
    position: absolute;
    z-index: 2;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--color-surface-inverse);
    transform: translateX(-1px);
  }
</style>
