<svelte:options runes={true} />

<script lang="ts">
  import { clamp } from '../../../shared/math';
  import TimelineVisualizer from './TimelineVisualizer.svelte';

  let {
    count,
    intervalPercent,
    currentProgress01,
    label,
  } = $props<{
    count: number;
    intervalPercent: number;
    currentProgress01?: number;
    label: string;
  }>();

  const intervalRatio = $derived(intervalPercent / 100);
  const repeatDurationRatio = $derived(
    1 / (1 + (count - 1) * intervalRatio),
  );
  const repeatStartStepRatio = $derived(repeatDurationRatio * intervalRatio);
  const sharedEdgeRadiusScale = $derived(
    clamp((intervalPercent - 100) / 50, 0, 1),
  );
  const hasSharedBorders = $derived(Math.abs(intervalPercent - 100) <= 1e-9);
  const repeatBlocks = $derived(Array.from({ length: count }, (_, index) => ({
    index,
    leftPercent: index * repeatStartStepRatio * 100,
    widthPercent: repeatDurationRatio * 100,
    leftRadiusScale: index === 0 ? 1 : sharedEdgeRadiusScale,
    rightRadiusScale: index === count - 1 ? 1 : sharedEdgeRadiusScale,
    hidesLeftBorder: hasSharedBorders && index > 0,
  })));
</script>

<TimelineVisualizer playheadProgress01={currentProgress01} rulerGap="compact" {label}>
  {#each repeatBlocks as block (block.index)}
    <span
      class="repeat-block"
      style={`left:${block.leftPercent}%;width:${block.widthPercent}%;--repeat-left-radius:calc(var(--radius-4) * ${block.leftRadiusScale});--repeat-right-radius:calc(var(--radius-4) * ${block.rightRadiusScale});--repeat-left-border-width:${block.hidesLeftBorder ? 0 : 1}px;`}
    ></span>
  {/each}
</TimelineVisualizer>

<style lang="scss">
  .repeat-block {
    --repeat-accent: var(--device-category-accent, var(--color-category-time));

    position: absolute;
    top: 0;
    bottom: 0;
    box-sizing: border-box;
    min-width: 1px;
    border: 1px solid var(--repeat-accent);
    border-left-width: var(--repeat-left-border-width, 1px);
    border-radius:
      var(--repeat-left-radius, var(--radius-4))
      var(--repeat-right-radius, var(--radius-4))
      var(--repeat-right-radius, var(--radius-4))
      var(--repeat-left-radius, var(--radius-4));
    background: color-mix(in srgb, var(--repeat-accent) 32%, transparent);
  }
</style>
