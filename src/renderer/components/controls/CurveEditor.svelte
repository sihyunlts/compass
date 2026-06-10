<svelte:options runes={true} />

<script lang="ts">
  /**
   * Interactive curve editor shared by modulation and time-warp device cards.
   * Owns node editing, segment control editing, and hidden-input synchronization for form events.
   */
  import {
    buildCurveSegments,
    canSegmentCurveBendAffectShape,
    evaluateNormalizedCurveAt,
    toSegmentCurveBend,
    toSegmentCurvePoint,
    type CurvePoint,
  } from '../../../core/curve-segments';
  import { resolveSegmentCurvePoint } from '../../../core/modulation/curve';
  import { clamp } from '../../../shared/math';
  import type { CurveNode } from '../../../shared/model';
  import ControlSurfaceFrame from './ControlSurfaceFrame.svelte';
  import FieldShell from '../fields/FieldShell.svelte';

  interface EditableCurve {
    divisions: number;
    nodes: CurveNode[];
  }

  type DragTarget =
    | { kind: 'node'; nodeId: string }
    | { kind: 'segment-control'; startNodeId: string }
    | null;

  type PlottedNode = {
    id: string;
    t: number;
    v: number;
    x: number;
    y: number;
  };

  type PlottedSegmentControl = {
    key: string;
    startNodeId: string;
    endNodeId: string;
    x: number;
    y: number;
    isStub: boolean;
  };

  let {
    label,
    deviceId,
    curve,
    currentProgress01 = 0,
    hiddenInputAction = 'set-modulation-curve-nodes',
    sanitizeNodes,
    valueMin = -1,
    valueMax = 1,
    guideValue = 0,
    wrapperClass = '',
  } = $props<{
    label?: string;
    deviceId: string;
    curve: EditableCurve;
    currentProgress01?: number;
    hiddenInputAction?: string;
    sanitizeNodes: (rawNodes: unknown) => CurveNode[];
    valueMin?: number;
    valueMax?: number;
    guideValue?: number | null;
    wrapperClass?: string;
  }>();

  let editorEl = $state<HTMLDivElement | null>(null);
  let hiddenInputEl = $state<HTMLInputElement | null>(null);
  let selectedNodeId = $state<string | null>(null);
  let dragTarget = $state<DragTarget>(null);
  let activePointerNodeId = $state<string | null>(null);
  let isDragging = $state(false);
  let pointerDownClientX = $state(0);
  let pointerDownClientY = $state(0);
  let pointerDidMove = $state(false);
  let lastClickedNodeId = $state<string | null>(null);
  let lastClickedAt = $state(0);
  let localNodes = $state<CurveNode[]>([]);
  let isKeyboardDeleteEnabled = $state(false);

  const NODE_DOUBLE_CLICK_WINDOW_MS = 300;
  const NODE_CLICK_MOVE_THRESHOLD_PX = 4;
  const CURVE_SOFT_SNAP_DISTANCE_PX = 10;

  const roundCurveNumber = (value: number): number =>
    Number(value.toFixed(6));

  const smoothstep = (value: number): number => {
    const clamped = clamp(value, 0, 1);
    return clamped * clamped * (3 - 2 * clamped);
  };

  const toResponsiveCurveValue = (
    startNode: CurveNode,
    endNode: CurveNode,
    value: number,
  ): number => {
    const lowPoint = toSegmentCurvePoint(startNode, endNode, -1);
    const highPoint = toSegmentCurvePoint(startNode, endNode, 1);
    const minValue = Math.min(lowPoint.v, highPoint.v);
    const maxValue = Math.max(lowPoint.v, highPoint.v);
    const span = maxValue - minValue;
    if (span <= 0.000001) {
      return roundCurveNumber(clamp(value, minValue, maxValue));
    }

    const normalized = clamp((value - minValue) / span, 0, 1);
    const eased = smoothstep(smoothstep(normalized));
    return roundCurveNumber(minValue + span * eased);
  };

  const divisions = $derived(Math.max(2, Math.round(curve.divisions)));
  const curveValueMin = $derived(Math.min(valueMin, valueMax));
  const curveValueMax = $derived(Math.max(valueMin, valueMax));
  const curveValueSpan = $derived(Math.max(curveValueMax - curveValueMin, 0.000001));
  const clampedProgress01 = $derived(
    clamp(Number.isFinite(currentProgress01) ? currentProgress01 : 0, 0, 1),
  );
  const sortedNodes = $derived.by(() =>
    [...localNodes].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id)));
  const curveSegments = $derived.by(() => buildCurveSegments(sortedNodes));

  const toPlotY = (value: number): number =>
    (1 - ((value - curveValueMin) / curveValueSpan)) * 100;

  const toPlotPoint = (point: CurvePoint): { x: number; y: number } => ({
    x: point.t * 100,
    y: toPlotY(point.v),
  });

  const plottedNodes = $derived.by<PlottedNode[]>(() => sortedNodes.map((node) => ({
    id: node.id,
    t: node.t,
    v: node.v,
    x: node.t * 100,
    y: toPlotY(node.v),
  })));

  const plottedSegmentControls = $derived.by<PlottedSegmentControl[]>(() =>
    sortedNodes.slice(0, -1).flatMap((node, index) => {
      const nextNode = sortedNodes[index + 1];
      if (!nextNode || !canSegmentCurveBendAffectShape(node, nextNode)) {
        return [];
      }

      const resolved = resolveSegmentCurvePoint(sortedNodes, index);
      const point = resolved.point ?? {
        t: (node.t + nextNode.t) * 0.5,
        v: (node.v + nextNode.v) * 0.5,
      };
      return [{
        key: `${node.id}:${nextNode.id}`,
        startNodeId: node.id,
        endNodeId: nextNode.id,
        ...toPlotPoint(point),
        isStub: resolved.isStub,
      }];
    }));

  const SAMPLE_STEPS_PER_SEGMENT = 24;

  const curveLinePath = $derived.by(() => {
    const firstNode = plottedNodes[0];
    if (!firstNode) {
      return '';
    }

    let path = `M ${firstNode.x} ${firstNode.y}`;
    for (let index = 0; index < curveSegments.length; index += 1) {
      const segment = curveSegments[index];
      const spanT = segment.end.t - segment.start.t;
      for (let step = 1; step <= SAMPLE_STEPS_PER_SEGMENT; step += 1) {
        const progress = step / SAMPLE_STEPS_PER_SEGMENT;
        const curveProgress = evaluateNormalizedCurveAt(progress, segment.bend);
        const point = toPlotPoint({
          t: segment.start.t + spanT * progress,
          v: segment.start.v + (segment.end.v - segment.start.v) * curveProgress,
        });
        path += ` L ${point.x} ${point.y}`;
      }
    }
    return path;
  });

  const curveFillPath = $derived.by(() => {
    const firstNode = plottedNodes[0];
    const lastNode = plottedNodes[plottedNodes.length - 1];
    if (!firstNode || !lastNode || !curveLinePath) {
      return '';
    }

    return `${curveLinePath} L ${lastNode.x} 100 L ${firstNode.x} 100 Z`;
  });

  const createNodeId = (): string =>
    `curve-node-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;

  const toSoftSnappedRatio = (
    value: number,
    snapPoints: ReadonlyArray<number>,
    spanPx: number,
  ): number => {
    if (snapPoints.length === 0 || spanPx <= 0) {
      return value;
    }

    const threshold = CURVE_SOFT_SNAP_DISTANCE_PX / spanPx;
    let nearest = value;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const snapPoint of snapPoints) {
      const distance = Math.abs(value - snapPoint);
      if (distance < nearestDistance) {
        nearest = snapPoint;
        nearestDistance = distance;
      }
    }

    return nearestDistance <= threshold ? nearest : value;
  };

  const isEndpointNode = (nodeId: string | null): boolean => {
    if (nodeId === null || sortedNodes.length < 2) {
      return false;
    }

    return nodeId === sortedNodes[0]?.id || nodeId === sortedNodes[sortedNodes.length - 1]?.id;
  };

  const canDeleteNode = (nodeId: string | null): boolean =>
    nodeId !== null
    && sortedNodes.length > 2
    && !isEndpointNode(nodeId)
    && sortedNodes.some((node) => node.id === nodeId);

  const emitNodes = (nodes: CurveNode[]): void => {
    localNodes = sanitizeNodes(nodes);
    if (!hiddenInputEl) {
      return;
    }

    hiddenInputEl.value = JSON.stringify(localNodes);
    hiddenInputEl.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const resolvePoint = (
    clientX: number,
    clientY: number,
    options?: {
      snapToDivisions?: boolean;
      snapToCenterLine?: boolean;
    },
  ): { t: number; v: number } | null => {
    if (!editorEl) {
      return null;
    }

    const rect = editorEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const ratioX = clamp((clientX - rect.left) / rect.width, 0, 1);
    const ratioY = clamp((clientY - rect.top) / rect.height, 0, 1);
    const divisionRatio = Math.round((ratioX * divisions)) / divisions;
    const snappedRatioX = options?.snapToDivisions === false
      ? ratioX
      : toSoftSnappedRatio(ratioX, [divisionRatio], rect.width);
    const snappedRatioY = options?.snapToCenterLine === false
      ? ratioY
      : toSoftSnappedRatio(
        ratioY,
        guideValue === null ? [] : [toPlotY(guideValue) / 100],
        rect.height,
      );
    const v = clamp(
      curveValueMax - snappedRatioY * curveValueSpan,
      curveValueMin,
      curveValueMax,
    );

    return {
      t: roundCurveNumber(snappedRatioX),
      v: roundCurveNumber(v),
    };
  };

  const insertNodeAtPoint = (point: { t: number; v: number }): void => {
    const existingNode = sortedNodes.find((node) => node.t.toFixed(6) === point.t.toFixed(6));
    if (existingNode) {
      selectedNodeId = existingNode.id;
      return;
    }

    const nextNode: CurveNode = {
      id: createNodeId(),
      t: point.t,
      v: point.v,
    };
    emitNodes([...sortedNodes, nextNode]);
    selectedNodeId = nextNode.id;
  };

  const deleteNode = (nodeId: string | null = selectedNodeId): void => {
    if (!canDeleteNode(nodeId)) {
      return;
    }

    const next = sortedNodes.filter((node) => node.id !== nodeId);
    if (next.length < 2) {
      return;
    }

    emitNodes(next);
    selectedNodeId = next[0]?.id ?? null;
  };

  const beginDrag = (event: MouseEvent, nextTarget: DragTarget): void => {
    isDragging = true;
    dragTarget = nextTarget;
    pointerDownClientX = event.clientX;
    pointerDownClientY = event.clientY;
    pointerDidMove = false;
    event.preventDefault();
  };

  const handleNodeMouseDown = (event: MouseEvent, nodeId: string): void => {
    if (event.button !== 0) {
      return;
    }

    isKeyboardDeleteEnabled = true;
    activePointerNodeId = nodeId;
    selectedNodeId = nodeId;
    beginDrag(event, { kind: 'node', nodeId });
  };

  const handleSegmentControlMouseDown = (event: MouseEvent, startNodeId: string): void => {
    if (event.button !== 0) {
      return;
    }

    isKeyboardDeleteEnabled = true;
    activePointerNodeId = null;
    beginDrag(event, { kind: 'segment-control', startNodeId });
  };

  const markPointerMovedIfNeeded = (clientX: number, clientY: number): void => {
    if (
      !pointerDidMove
      && (
        Math.abs(clientX - pointerDownClientX) > NODE_CLICK_MOVE_THRESHOLD_PX
        || Math.abs(clientY - pointerDownClientY) > NODE_CLICK_MOVE_THRESHOLD_PX
      )
    ) {
      pointerDidMove = true;
    }
  };

  const updateDraggingNode = (nodeId: string, clientX: number, clientY: number): void => {
    markPointerMovedIfNeeded(clientX, clientY);

    const point = resolvePoint(clientX, clientY);
    if (!point) {
      return;
    }

    const currentIndex = sortedNodes.findIndex((node) => node.id === nodeId);
    if (currentIndex === -1) {
      return;
    }

    const current = sortedNodes[currentIndex];
    const previousNode = sortedNodes[currentIndex - 1] ?? null;
    const nextNode = sortedNodes[currentIndex + 1] ?? null;
    const isEndpoint = previousNode === null || nextNode === null;
    const nextT = isEndpoint
      ? current.t
      : roundCurveNumber(clamp(
        point.t,
        previousNode.t + 0.000001,
        nextNode.t - 0.000001,
      ));

    const next = sortedNodes.map((node) => node.id === nodeId
      ? { ...node, t: nextT, v: point.v }
      : node);
    emitNodes(next);
  };

  const updateDraggingSegmentControl = (
    startNodeId: string,
    clientX: number,
    clientY: number,
  ): void => {
    markPointerMovedIfNeeded(clientX, clientY);

    const point = resolvePoint(clientX, clientY, { snapToDivisions: false });
    if (!point) {
      return;
    }

    const startIndex = sortedNodes.findIndex((node) => node.id === startNodeId);
    if (startIndex === -1 || startIndex >= sortedNodes.length - 1) {
      return;
    }

    const startNode = sortedNodes[startIndex];
    const endNode = sortedNodes[startIndex + 1];
    const nextCurveBend = toSegmentCurveBend(startNode, endNode, {
      t: (startNode.t + endNode.t) * 0.5,
      v: toResponsiveCurveValue(startNode, endNode, point.v),
    });

    const next = sortedNodes.map((node, index) => {
      if (index !== startIndex) {
        return node;
      }

      return {
        id: node.id,
        t: node.t,
        v: node.v,
        ...(Math.abs(nextCurveBend) > 0.0001 ? { nextCurveBend } : {}),
      };
    });
    emitNodes(next);
  };

  const clearPointerState = (): void => {
    isDragging = false;
    dragTarget = null;
    activePointerNodeId = null;
    pointerDidMove = false;
  };

  const handleEditorDoubleClick = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return;
    }

    isKeyboardDeleteEnabled = true;
    const target = event.target;
    const interactiveHit = target instanceof Element
      ? target.closest('[data-curve-node-id], [data-curve-segment-control-id]')
      : null;
    if (interactiveHit) {
      return;
    }

    const point = resolvePoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    insertNodeAtPoint(point);
  };

  $effect(() => {
    if (isDragging) {
      return;
    }

    const nextNodes: CurveNode[] = sanitizeNodes(curve.nodes);
    localNodes = nextNodes;
    if (!nextNodes.some((node) => node.id === selectedNodeId)) {
      selectedNodeId = nextNodes[0]?.id ?? null;
    }
  });

  $effect(() => {
    const handlePointerMove = (event: MouseEvent): void => {
      if (!isDragging || !dragTarget) {
        return;
      }

      if (dragTarget.kind === 'node') {
        updateDraggingNode(dragTarget.nodeId, event.clientX, event.clientY);
        return;
      }

      updateDraggingSegmentControl(
        dragTarget.startNodeId,
        event.clientX,
        event.clientY,
      );
    };

    const handlePointerUp = (event: MouseEvent): void => {
      if (!isDragging) {
        return;
      }

      if (activePointerNodeId && !pointerDidMove) {
        if (
          lastClickedNodeId === activePointerNodeId
          && event.timeStamp - lastClickedAt <= NODE_DOUBLE_CLICK_WINDOW_MS
        ) {
          deleteNode(activePointerNodeId);
          lastClickedNodeId = null;
          lastClickedAt = 0;
        } else {
          lastClickedNodeId = activePointerNodeId;
          lastClickedAt = event.timeStamp;
        }
      } else if (pointerDidMove) {
        lastClickedNodeId = null;
        lastClickedAt = 0;
      }

      clearPointerState();
    };

    const handlePointerCancel = (): void => {
      if (!isDragging) {
        return;
      }
      clearPointerState();
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('mouseleave', handlePointerCancel);
    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('mouseleave', handlePointerCancel);
    };
  });

  $effect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!isKeyboardDeleteEnabled || !canDeleteNode(selectedNodeId)) {
        return;
      }
      if (event.defaultPrevented || (event.key !== 'Backspace' && event.key !== 'Delete')) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement
        && (
          target.isContentEditable
          || target.tagName === 'INPUT'
          || target.tagName === 'SELECT'
          || target.tagName === 'TEXTAREA'
        )
      ) {
        return;
      }

      event.preventDefault();
      deleteNode(selectedNodeId);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  });
</script>

{#snippet curveEditor()}
<div class="curve-editor-wrap">
  <ControlSurfaceFrame fill="stretch">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="curve-editor"
      bind:this={editorEl}
      style={`--curve-divisions:${divisions};--curve-guide-y:${guideValue === null ? '-100%' : `${toPlotY(guideValue).toFixed(3)}%`};`}
      ondblclick={handleEditorDoubleClick}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {#if curveFillPath}
          <path class="curve-fill" d={curveFillPath} />
        {/if}
        {#if curveLinePath}
          <path class="curve-line-halo" d={curveLinePath} />
          <path class="curve-line" d={curveLinePath} />
        {/if}
      </svg>
      <div class="curve-editor-segment-controls">
        {#each plottedSegmentControls as control (control.key)}
          <button
            type="button"
            class="curve-editor-segment-control"
            class:is-stub={control.isStub}
            data-curve-segment-control-id={control.key}
            style={`left:${control.x}%;top:${control.y}%;`}
            onmousedown={(event) => handleSegmentControlMouseDown(event, control.startNodeId)}
            aria-label={`Curve point between ${control.startNodeId} and ${control.endNodeId}`}
          ></button>
        {/each}
      </div>
      <div class="curve-editor-nodes">
        {#each plottedNodes as node (node.id)}
          <button
            type="button"
            class="curve-editor-node"
            class:selected={node.id === selectedNodeId}
            data-curve-node-id={node.id}
            style={`left:${node.x}%;top:${node.y}%;`}
            onmousedown={(event) => handleNodeMouseDown(event, node.id)}
            aria-label={`Curve node at ${node.t.toFixed(3)}, ${node.v.toFixed(3)}`}
          ></button>
        {/each}
      </div>
      <div class="curve-editor-playhead" style={`left:${(clampedProgress01 * 100).toFixed(3)}%;`}></div>
    </div>
  </ControlSurfaceFrame>

  <input
    bind:this={hiddenInputEl}
    type="hidden"
    value={JSON.stringify(sortedNodes)}
    data-action={hiddenInputAction}
    data-id={deviceId}
  />
</div>
{/snippet}

{#if label}
  <FieldShell {label} class={wrapperClass}>
    {@render curveEditor()}
  </FieldShell>
{:else}
  {@render curveEditor()}
{/if}

<style lang="scss">
  .curve-editor {
    &-wrap {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      max-height: 100%;
    }

    position: relative;
    min-height: 0;
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
        transparent calc(var(--curve-guide-y, -100%) - 0.5px),
        rgb(var(--rgb-white) / 0.14) calc(var(--curve-guide-y, -100%) - 0.5px),
        rgb(var(--rgb-white) / 0.14) calc(var(--curve-guide-y, -100%) + 0.5px),
        transparent calc(var(--curve-guide-y, -100%) + 0.5px)
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

    &-segment-controls,
    &-nodes {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }

    &-segment-control,
    &-node {
      position: absolute;
      transform: translate(-50%, -50%);
      padding: 0;
      cursor: pointer;
      pointer-events: auto;
    }

    &-segment-control {
      z-index: 1;
      width: 0.75rem;
      height: 0.75rem;
      border: 1px solid rgb(var(--rgb-white) / 0.4);
      border-radius: var(--radius-round);
      background: rgb(var(--rgb-white) / 0.2);

      &::before {
        content: '';
        position: absolute;
        inset: -0.3rem;
      }

      &.is-stub {
        background: rgb(var(--rgb-white) / 0.1);
        border-color: rgb(var(--rgb-white) / 0.25);
      }
    }

    &-node {
      z-index: 2;
      width: 0.75rem;
      height: 0.75rem;
      border: 1px solid var(--neutral-10);
      border-radius: var(--radius-round);
      background: var(--neutral-90);

      &::before {
        content: '';
        position: absolute;
        inset: -0.28rem;
      }

      &.selected {
        background: var(--accent-500);
        border-width: 1.5px;
      }
    }

    &-playhead {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 1px;
      background: rgb(var(--rgb-white) / 0.25);
      pointer-events: none;
      transform: translateX(-50%);
    }
  }
</style>
