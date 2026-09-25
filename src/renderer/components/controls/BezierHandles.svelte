<svelte:options runes={true} />

<script lang="ts">
  import type { BezierHandleKind } from '../../../shared/bezier-handles';
  import { i18n } from '../../i18n.svelte';

  interface PlottedHandle {
    nodeId: string;
    kind: BezierHandleKind;
    x: number;
    y: number;
    anchorX: number;
    anchorY: number;
  }
  let { handles, onHandlePointerDown } = $props<{
    handles: PlottedHandle[];
    onHandlePointerDown: (event: PointerEvent, nodeId: string, kind: BezierHandleKind) => void;
  }>();
</script>

<div class="bezier-handles">
  <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    {#each handles as handle (`${handle.nodeId}:${handle.kind}`)}
      <line x1={handle.anchorX} y1={handle.anchorY} x2={handle.x} y2={handle.y} />
    {/each}
  </svg>
  {#each handles as handle (`${handle.nodeId}:${handle.kind}`)}
    <button
      type="button"
      class="bezier-handle"
      data-bezier-handle
      style={`left:${handle.x}%;top:${handle.y}%;`}
      aria-label={i18n.t('control.bezierHandle')}
      onpointerdown={(event) => onHandlePointerDown(event, handle.nodeId, handle.kind)}
    ></button>
  {/each}
</div>
<style lang="scss">
  .bezier-handles {
    position: absolute;
    inset: 0;
    pointer-events: none;
    svg { width: 100%; height: 100%; display: block; }
    line {
      stroke: var(--color-text-secondary);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }
  }
  .bezier-handle {
    position: absolute;
    transform: translate(-50%, -50%);
    z-index: 1;
    width: 0.55rem;
    height: 0.55rem;
    padding: 0;
    border: 1px solid var(--color-text-secondary);
    border-radius: var(--radius-round);
    background: var(--color-surface-interactive);
    pointer-events: auto;
    cursor: grab;
    &:active { cursor: grabbing; }
  }
</style>
