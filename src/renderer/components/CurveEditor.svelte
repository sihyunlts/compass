<svelte:options runes={true} />

<script lang="ts">
  /**
   * Interactive modulation-curve editor used by modulator device cards.
   * Owns node editing, snapping, and hidden-input synchronization for form events.
   */
  import { clamp } from '../../shared/math';
  import Button from './Button.svelte';
  import type { CurveNode, ModulationCurve } from '../../shared/model';

  let {
    deviceId,
    curve,
    currentBeat = 0,
  } = $props<{
    deviceId: string;
    curve: ModulationCurve;
    currentBeat?: number;
  }>();

  let editorEl = $state<HTMLElement | null>(null);
  let hiddenInputEl = $state<HTMLInputElement | null>(null);
  let pointerId = $state<number | null>(null);
  let selectedNodeId = $state<string | null>(null);
  let draggingNodeId = $state<string | null>(null);
  let localNodes = $state<CurveNode[]>([]);

  const divisions = $derived(Math.max(2, Math.round(curve.divisions)));
  const clampedBeat = $derived(clamp(Number.isFinite(currentBeat) ? currentBeat : 0, 0, 1));
  const sortedNodes = $derived.by(() =>
    [...localNodes].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id)));
  const selectedNode = $derived.by(() =>
    sortedNodes.find((node) => node.id === selectedNodeId) ?? null);
  const plottedNodes = $derived.by(() => sortedNodes.map((node) => ({
    id: node.id,
    t: node.t,
    v: node.v,
    x: node.t * 100,
    y: (1 - ((node.v + 1) * 0.5)) * 100,
  })));
  const curveLinePoints = $derived.by(() =>
    plottedNodes.map((node) => `${node.x},${node.y}`).join(' '));
  const curveFillPoints = $derived.by(() => {
    if (plottedNodes.length < 2) {
      return '';
    }
    const first = plottedNodes[0];
    const last = plottedNodes[plottedNodes.length - 1];
    const body = plottedNodes.map((node) => `${node.x},${node.y}`).join(' ');
    return `${body} ${last.x},100 ${first.x},100`;
  });

  const createNodeId = (): string =>
    `curve-node-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;

  const sanitizeNodes = (source: ReadonlyArray<CurveNode>): CurveNode[] => {
    const normalized: CurveNode[] = [];
    for (const raw of source) {
      const t = clamp(Number(raw.t), 0, 1);
      const v = clamp(Number(raw.v), -1, 1);
      if (!Number.isFinite(t) || !Number.isFinite(v)) {
        continue;
      }

      normalized.push({
        id: raw.id,
        t: Number(t.toFixed(6)),
        v: Number(v.toFixed(6)),
      });
    }

    const seenTimes: string[] = [];
    const nodes: CurveNode[] = [];
    for (const node of normalized.sort((a, b) => a.t - b.t)) {
      const key = node.t.toFixed(6);
      if (seenTimes.includes(key)) {
        continue;
      }
      seenTimes.push(key);
      nodes.push(node);
    }

    if (nodes.length >= 2) {
      return nodes;
    }

    return [
      { id: 'curve-node-start', t: 0, v: 0 },
      { id: 'curve-node-end', t: 1, v: 0 },
    ];
  };

  const emitNodes = (nodes: CurveNode[]): void => {
    localNodes = sanitizeNodes(nodes);
    if (!hiddenInputEl) {
      return;
    }

    hiddenInputEl.value = JSON.stringify(localNodes);
    hiddenInputEl.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const resolvePoint = (clientX: number, clientY: number): { t: number; v: number } | null => {
    if (!editorEl) {
      return null;
    }

    const rect = editorEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const ratioX = clamp((clientX - rect.left) / rect.width, 0, 1);
    const ratioY = clamp((clientY - rect.top) / rect.height, 0, 1);
    const snappedT = Math.round((ratioX * divisions)) / divisions;
    const v = clamp(1 - ratioY * 2, -1, 1);

    return {
      t: Number(snappedT.toFixed(6)),
      v: Number(v.toFixed(6)),
    };
  };

  const resolveAvailableSnapT = (): number | null => {
    const used = new Set(sortedNodes.map((node) => node.t.toFixed(6)));
    const preferred = Math.round(divisions / 2);
    const candidates: number[] = [];
    for (let i = 0; i <= divisions; i += 1) {
      candidates.push(i);
    }
    candidates.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));

    for (const index of candidates) {
      const t = Number((index / divisions).toFixed(6));
      if (!used.has(t.toFixed(6))) {
        return t;
      }
    }

    return null;
  };

  const handleAddNode = (): void => {
    const t = resolveAvailableSnapT();
    if (t === null) {
      return;
    }

    const nextNode: CurveNode = {
      id: createNodeId(),
      t,
      v: 0,
    };
    emitNodes([...sortedNodes, nextNode]);
    selectedNodeId = nextNode.id;
  };

  const handleDeleteNode = (): void => {
    if (!selectedNodeId || sortedNodes.length <= 2) {
      return;
    }

    const next = sortedNodes.filter((node) => node.id !== selectedNodeId);
    if (next.length < 2) {
      return;
    }
    emitNodes(next);
    selectedNodeId = next[0]?.id ?? null;
  };

  const handleNodePointerDown = (event: PointerEvent, nodeId: string): void => {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }

    pointerId = event.pointerId;
    draggingNodeId = nodeId;
    selectedNodeId = nodeId;
    editorEl?.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const updateDraggingNode = (clientX: number, clientY: number): void => {
    if (!draggingNodeId) {
      return;
    }

    const point = resolvePoint(clientX, clientY);
    if (!point) {
      return;
    }

    const current = sortedNodes.find((node) => node.id === draggingNodeId);
    if (!current) {
      return;
    }

    const occupied = new Set(
      sortedNodes
        .filter((node) => node.id !== draggingNodeId)
        .map((node) => node.t.toFixed(6)),
    );
    const safeT = occupied.has(point.t.toFixed(6)) ? current.t : point.t;
    const next = sortedNodes.map((node) => node.id === draggingNodeId
      ? { ...node, t: safeT, v: point.v }
      : node);
    emitNodes(next);
  };

  const clearPointerState = (): void => {
    if (
      editorEl
      && pointerId !== null
      && editorEl.hasPointerCapture(pointerId)
    ) {
      editorEl.releasePointerCapture(pointerId);
    }
    pointerId = null;
    draggingNodeId = null;
  };

  const handleEditorPointerMove = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId) {
      return;
    }
    updateDraggingNode(event.clientX, event.clientY);
  };

  const handleEditorPointerUp = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId) {
      return;
    }
    clearPointerState();
  };

  const handleEditorPointerCancel = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId) {
      return;
    }
    clearPointerState();
  };

  $effect(() => {
    if (draggingNodeId !== null) {
      return;
    }
    localNodes = sanitizeNodes(curve.nodes);
    if (!selectedNodeId && localNodes.length > 0) {
      selectedNodeId = localNodes[0].id;
    }
  });
</script>

<div class="curve-editor-wrap modulation-curve-control">
  <div class="curve-editor-toolbar">
    <Button text="Add Node" onClick={handleAddNode} />
    <Button
      text="Delete Selected Node"
      disabled={!selectedNodeId || sortedNodes.length <= 2}
      onClick={handleDeleteNode}
    />
    <span class="curve-editor-readout">
      {#if selectedNode}
        T {selectedNode.t.toFixed(3)} | V {selectedNode.v.toFixed(3)}
      {:else}
        No Node Selected
      {/if}
    </span>
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="curve-editor"
    bind:this={editorEl}
    style={`--curve-divisions:${divisions};`}
    onpointermove={handleEditorPointerMove}
    onpointerup={handleEditorPointerUp}
    onpointercancel={handleEditorPointerCancel}
  >
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      {#if curveFillPoints}
        <polygon class="curve-fill" points={curveFillPoints} />
      {/if}
      {#if curveLinePoints}
        <polyline class="curve-line-halo" points={curveLinePoints} />
        <polyline class="curve-line" points={curveLinePoints} />
      {/if}
      {#each plottedNodes as node (node.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <circle
          class:selected={node.id === selectedNodeId}
          cx={node.x}
          cy={node.y}
          r="2.2"
          onpointerdown={(event) => handleNodePointerDown(event, node.id)}
        />
      {/each}
    </svg>
    <div class="curve-editor-playhead" style={`left:${(clampedBeat * 100).toFixed(3)}%;`}></div>
  </div>

  <input
    bind:this={hiddenInputEl}
    type="hidden"
    value={JSON.stringify(sortedNodes)}
    data-action="set-modulation-curve-nodes"
    data-id={deviceId}
  />
</div>

<style lang="scss">
  .curve-editor-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--gap-6);
    min-width: 0;
  }

  .curve-editor-toolbar {
    display: flex;
    align-items: center;
    gap: var(--gap-6);
    flex-wrap: wrap;
  }

  .curve-editor-readout {
    color: var(--neutral-50);
    font-size: var(--text-12);
  }

  .curve-editor {
    position: relative;
    height: 7.5rem;
    border: 1px solid var(--neutral-30);
    border-radius: var(--radius-6);
    background:
      repeating-linear-gradient(
        to right,
        rgb(var(--rgb-white) / 0.03) 0,
        rgb(var(--rgb-white) / 0.03) 1px,
        transparent 1px,
        transparent calc(100% / var(--curve-divisions, 16))
      ),
      linear-gradient(
        to bottom,
        transparent calc(50% - 0.5px),
        rgb(var(--rgb-white) / 0.14) calc(50% - 0.5px),
        rgb(var(--rgb-white) / 0.14) calc(50% + 0.5px),
        transparent calc(50% + 0.5px)
      ),
      var(--neutral-10);
    overflow: hidden;

    svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    .curve-fill {
      fill: color-mix(in srgb, var(--accent-500) 22%, transparent);
    }

    .curve-line-halo {
      fill: none;
      stroke: rgb(var(--rgb-white) / 0.2);
      stroke-width: 2.6;
      vector-effect: non-scaling-stroke;
    }

    .curve-line {
      fill: none;
      stroke: var(--accent-500);
      stroke-width: 1.4;
      stroke-linejoin: round;
      stroke-linecap: round;
      vector-effect: non-scaling-stroke;
    }

    circle {
      fill: var(--neutral-90);
      stroke: var(--neutral-10);
      stroke-width: 0.6;
      cursor: pointer;

      &.selected {
        fill: var(--accent-500);
        stroke-width: 1;
      }
    }
  }

  .curve-editor-playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgb(var(--rgb-white) / 0.25);
    pointer-events: none;
    transform: translateX(-50%);
  }
</style>
