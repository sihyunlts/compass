<svelte:options runes={true} />

<script lang="ts">
  /**
   * Interactive curve editor shared by modulation and time-warp device cards.
   * Owns node editing and paired Bézier handles for shared curve controls.
   */
  import { PointerCaptureSession } from '../../features/rack/pointer-capture-session';
  import type { RendererControlChange } from '../../../devices/control-types';
  import {
    buildCurveSegments,
    roundCurveNumber,
    type CurvePoint,
  } from '../../../core/curve-segments';
  import { clamp } from '../../../shared/math';
  import type { CurveNode } from '../../../shared/model';
  import { CURVE_DIVISION_OPTIONS } from '../../../core/curve-divisions';
  import ControlSurfaceFrame from './ControlSurfaceFrame.svelte';
  import BezierHandles from './BezierHandles.svelte';
  import {
    moveBezierHandle,
    type BezierHandles as HandleState,
    type BezierHandleKind as HandleKind,
  } from '../../../shared/bezier-handles';
  import DropdownOptionList from '../primitives/DropdownOptionList.svelte';
  import FloatingDropdown from '../primitives/FloatingDropdown.svelte';
  import type { DropdownValue } from '../primitives/dropdown-types';
  import FieldShell from '../fields/FieldShell.svelte';
  import { i18n } from '../../i18n.svelte';
  import { performHapticFeedback } from '../../haptics';
  import {
    CONTROL_POINT_DRAG_THRESHOLD_PX,
    hasExceededControlPointDragThreshold,
    resolveSoftSnap,
  } from './control-point-editor';

  interface EditableCurve {
    divisions: number;
    nodes: CurveNode[];
  }

  type SnappedCurvePoint = CurvePoint & {
    snapTargets: { t: number | null; v: number | null };
  };

  type DragTarget =
    | { kind: 'node'; nodeId: string }
    | { kind: 'node-handle'; nodeId: string }
    | { kind: 'handle'; nodeId: string; handleKind: HandleKind }
    | null;

  type PlottedNode = {
    id: string;
    t: number;
    v: number;
    x: number;
    y: number;
  };

  type PlottedHandle = {
    nodeId: string;
    kind: HandleKind;
    x: number;
    y: number;
    anchorX: number;
    anchorY: number;
  };

  let {
    label,
    deviceId,
    curve,
    currentProgress01 = 0,
    controlAction = 'set-modulation-curve-nodes',
    sanitizeNodes,
    valueMin = -1,
    valueMax = 1,
    guideValue = 0,
    divisionsControlAction,
    onControlChange,
  } = $props<{
    label?: string;
    deviceId: string;
    curve: EditableCurve;
    currentProgress01?: number;
    controlAction?: string;
    sanitizeNodes: (rawNodes: unknown) => CurveNode[];
    valueMin?: number;
    valueMax?: number;
    guideValue?: number | null;
    divisionsControlAction?: string;
    onControlChange: (change: RendererControlChange) => void;
  }>();

  const pointerSession = new PointerCaptureSession<HTMLDivElement>({ onChanged: () => {} });
  let editorEl = $state<HTMLDivElement | null>(null);
  let selectedNodeId = $state<string | null>(null);
  let dragTarget = $state<DragTarget>(null);
  let activePointerNodeId = $state<string | null>(null);
  let pointerDownClientX = $state(0);
  let pointerDownClientY = $state(0);
  let pointerDidMove = $state(false);
  let lastClickedNodeId = $state<string | null>(null);
  let lastClickedAt = $state(0);
  let localNodes = $state<CurveNode[]>([]);
  let isKeyboardDeleteEnabled = $state(false);
  let divisionsMenuPoint = $state<{ x: number; y: number } | null>(null);
  let lastDragSnapSignature: string | null = null;
  let hasInitializedDragSnap = false;

  const NODE_DOUBLE_CLICK_WINDOW_MS = 300;

  const divisions = $derived(Math.max(2, Math.round(curve.divisions)));
  const divisionDropdownOptions = $derived(
    CURVE_DIVISION_OPTIONS.map((value) => ({ value, label: String(value) })),
  );
  const curveGridLineOffsets = $derived.by(() =>
    Array.from(
      { length: Math.max(divisions - 1, 0) },
      (_, index) => Number((((index + 1) / divisions) * 100).toFixed(3)),
    ));
  const curveValueMin = $derived(Math.min(valueMin, valueMax));
  const curveValueMax = $derived(Math.max(valueMin, valueMax));
  const curveValueSpan = $derived(Math.max(curveValueMax - curveValueMin, 0.000001));
  const clampedProgress01 = $derived(
    clamp(Number.isFinite(currentProgress01) ? currentProgress01 : 0, 0, 1),
  );
  const curveSegments = $derived.by(() => buildCurveSegments(localNodes));

  const toPlotY = (value: number): number =>
    (1 - ((value - curveValueMin) / curveValueSpan)) * 100;

  const toPlotPoint = (point: CurvePoint): { x: number; y: number } => ({
    x: point.t * 100,
    y: toPlotY(point.v),
  });

  const plottedNodes = $derived.by<PlottedNode[]>(() => localNodes.map((node) => ({
    id: node.id,
    t: node.t,
    v: node.v,
    x: node.t * 100,
    y: toPlotY(node.v),
  })));

  const plottedHandles = $derived.by<PlottedHandle[]>(() =>
    curveSegments.flatMap((segment, index) => {
      const handles: PlottedHandle[] = [];
      const start = localNodes[index];
      const end = localNodes[index + 1];
      if (start.id === selectedNodeId && start.handleOut) {
        const anchor = toPlotPoint(start);
        handles.push({ nodeId: start.id, kind: 'handleOut',
          ...toPlotPoint(segment.controlOut), anchorX: anchor.x, anchorY: anchor.y });
      }
      if (end.id === selectedNodeId && end.handleIn) {
        const anchor = toPlotPoint(end);
        handles.push({ nodeId: end.id, kind: 'handleIn',
          ...toPlotPoint(segment.controlIn), anchorX: anchor.x, anchorY: anchor.y });
      }
      return handles;
    }));

  const curveLinePath = $derived.by(() => {
    const firstNode = plottedNodes[0];
    if (!firstNode) return '';
    let path = `M ${firstNode.x} ${firstNode.y}`;
    for (const segment of curveSegments) {
      const out = toPlotPoint(segment.controlOut);
      const incoming = toPlotPoint(segment.controlIn);
      const end = toPlotPoint(segment.end);
      path += ` C ${out.x} ${out.y} ${incoming.x} ${incoming.y} ${end.x} ${end.y}`;
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

  const isEndpointNode = (nodeId: string | null): boolean => {
    if (nodeId === null || localNodes.length < 2) {
      return false;
    }

    return nodeId === localNodes[0]?.id || nodeId === localNodes[localNodes.length - 1]?.id;
  };

  const canDeleteNode = (nodeId: string | null): boolean =>
    nodeId !== null
    && localNodes.length > 2
    && !isEndpointNode(nodeId)
    && localNodes.some((node) => node.id === nodeId);

  const emitNodes = (nodes: CurveNode[]): void => {
    localNodes = sanitizeNodes(nodes);
    onControlChange({
      action: controlAction,
      deviceId,
      value: localNodes,
      finalize: false,
    });
  };

  const resolvePoint = (
    clientX: number,
    clientY: number,
    options?: {
      snapToDivisions?: boolean;
      snapToCenterLine?: boolean;
    },
  ): SnappedCurvePoint | null => {
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
    const snappedX = resolveSoftSnap(
      ratioX,
      options?.snapToDivisions === false ? [] : [divisionRatio],
      rect.width,
    );
    const snappedY = resolveSoftSnap(
      ratioY,
      options?.snapToCenterLine === false || guideValue === null
        ? [] : [toPlotY(guideValue) / 100],
      rect.height,
    );
    const v = clamp(
      curveValueMax - snappedY.value * curveValueSpan,
      curveValueMin,
      curveValueMax,
    );
    return {
      t: roundCurveNumber(snappedX.value),
      v: roundCurveNumber(v),
      snapTargets: {
        t: snappedX.target === null ? null : roundCurveNumber(snappedX.target),
        v: snappedY.target === null || guideValue === null ? null : roundCurveNumber(guideValue),
      },
    };
  };

  const resolveAppliedSnapSignature = (
    point: CurvePoint,
    targets: SnappedCurvePoint['snapTargets'],
  ): string | null => [
    targets.t !== null && roundCurveNumber(point.t) === targets.t ? `x:${targets.t}` : '',
    targets.v !== null && roundCurveNumber(point.v) === targets.v ? `y:${targets.v}` : '',
  ].filter(Boolean).join('|') || null;

  const performCurveSnapHaptic = (snapSignature: string | null): void => {
    if (!hasInitializedDragSnap) {
      hasInitializedDragSnap = true;
      lastDragSnapSignature = snapSignature;
      return;
    }
    if (snapSignature !== null && snapSignature !== lastDragSnapSignature) {
      performHapticFeedback('alignment');
    }
    lastDragSnapSignature = snapSignature;
  };

  const insertNodeAtPoint = (
    point: SnappedCurvePoint,
  ): void => {
    const existingNode = localNodes.find((node) => node.t.toFixed(6) === point.t.toFixed(6));
    if (existingNode) {
      selectedNodeId = existingNode.id;
      return;
    }

    const nextNode: CurveNode = {
      id: createNodeId(),
      t: point.t,
      v: point.v,
    };
    emitNodes([...localNodes, nextNode]);
    const insertedNode = localNodes.find((node) => node.id === nextNode.id);
    if (insertedNode && resolveAppliedSnapSignature(insertedNode, point.snapTargets)) {
      performHapticFeedback('alignment');
    }
    selectedNodeId = nextNode.id;
  };

  const deleteNode = (nodeId: string | null = selectedNodeId): void => {
    if (!canDeleteNode(nodeId)) {
      return;
    }

    const next = localNodes.filter((node) => node.id !== nodeId);
    if (next.length < 2) {
      return;
    }

    emitNodes(next);
    selectedNodeId = null;
  };

  const beginDrag = (event: PointerEvent, nextTarget: DragTarget): void => {
    if (!editorEl) return;
    pointerSession.begin(editorEl, event.pointerId);
    dragTarget = nextTarget;
    pointerDownClientX = event.clientX;
    pointerDownClientY = event.clientY;
    pointerDidMove = false;
    lastDragSnapSignature = null;
    hasInitializedDragSnap = false;
    event.preventDefault();
  };

  const handleNodePointerDown = (event: PointerEvent, nodeId: string): void => {
    if (event.button !== 0 || !event.isPrimary || pointerSession.isActive()) {
      return;
    }

    isKeyboardDeleteEnabled = true;
    activePointerNodeId = event.altKey ? null : nodeId;
    selectedNodeId = nodeId;
    beginDrag(event, { kind: event.altKey ? 'node-handle' : 'node', nodeId });
  };

  const handleHandlePointerDown = (event: PointerEvent, nodeId: string, handleKind: HandleKind): void => {
    if (event.button !== 0 || !event.isPrimary || pointerSession.isActive()) return;
    isKeyboardDeleteEnabled = true;
    activePointerNodeId = null;
    beginDrag(event, { kind: 'handle', nodeId, handleKind });
  };

  const markPointerMovedIfNeeded = (clientX: number, clientY: number): void => {
    if (
      !pointerDidMove
      && (
        hasExceededControlPointDragThreshold(
          clientX,
          clientY,
          pointerDownClientX,
          pointerDownClientY,
        )
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

    const currentIndex = localNodes.findIndex((node) => node.id === nodeId);
    if (currentIndex === -1) {
      return;
    }

    const current = localNodes[currentIndex];
    const previousNode = localNodes[currentIndex - 1] ?? null;
    const nextNode = localNodes[currentIndex + 1] ?? null;
    const isEndpoint = previousNode === null || nextNode === null;
    const nextT = isEndpoint
      ? current.t
      : clamp(
        point.t,
        previousNode.t + Math.min(0.000001, (current.t - previousNode.t) / 2),
        nextNode.t - Math.min(0.000001, (nextNode.t - current.t) / 2),
      );

    const next = localNodes.map((node) => node.id === nodeId
      ? { ...node, t: nextT, v: point.v }
      : node);
    emitNodes(next);
    const appliedNode = localNodes.find((node) => node.id === nodeId);
    performCurveSnapHaptic(appliedNode ? resolveAppliedSnapSignature(appliedNode, {
      t: isEndpoint ? null : point.snapTargets.t,
      v: point.snapTargets.v,
    }) : null);
  };

  const toHandleState = (node: CurveNode): HandleState => ({
    ...(node.handleIn ? { handleIn: { x: node.handleIn.t, y: node.handleIn.v } } : {}),
    ...(node.handleOut ? { handleOut: { x: node.handleOut.t, y: node.handleOut.v } } : {}),
  });

  const withHandleState = (node: CurveNode, handles: HandleState): CurveNode => ({
    id: node.id, t: node.t, v: node.v,
    ...(handles.handleIn ? { handleIn: { t: handles.handleIn.x, v: handles.handleIn.y } } : {}),
    ...(handles.handleOut ? { handleOut: { t: handles.handleOut.x, v: handles.handleOut.y } } : {}),
  });

  const updateDraggingHandle = (
    nodeId: string,
    kind: HandleKind,
    event: PointerEvent,
    independent = event.altKey,
  ): void => {
    markPointerMovedIfNeeded(event.clientX, event.clientY);
    const point = resolvePoint(event.clientX, event.clientY, { snapToDivisions: false, snapToCenterLine: false });
    const index = localNodes.findIndex((node) => node.id === nodeId);
    if (!point || index < 0) return;
    const node = localNodes[index];
    const neighbor = localNodes[index + (kind === 'handleIn' ? -1 : 1)];
    if (!neighbor) return;
    const rect = editorEl?.getBoundingClientRect();
    const nearNode = rect && Math.hypot(
      (point.t - node.t) * rect.width,
      (point.v - node.v) / curveValueSpan * rect.height,
    ) <= CONTROL_POINT_DRAG_THRESHOLD_PX;
    const offset = nearNode ? null : {
      x: roundCurveNumber(clamp(point.t, Math.min(node.t, neighbor.t), Math.max(node.t, neighbor.t)) - node.t),
      y: roundCurveNumber(point.v - node.v),
    };
    const handles = moveBezierHandle(toHandleState(node), kind, offset, independent);
    emitNodes(localNodes.map((candidate) => candidate.id === nodeId ? withHandleState(node, handles) : candidate));
  };

  const clearPointerState = (): void => {
    pointerSession.finish();
    dragTarget = null;
    activePointerNodeId = null;
    pointerDidMove = false;
    lastDragSnapSignature = null;
    hasInitializedDragSnap = false;
  };

  const handleEditorDoubleClick = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return;
    }

    isKeyboardDeleteEnabled = true;
    const target = event.target;
    const interactiveHit = target instanceof Element
      ? target.closest('[data-curve-node-id], [data-bezier-handle]')
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

  const handleEditorContextMenu = (event: MouseEvent): void => {
    if (!divisionsControlAction) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    divisionsMenuPoint = {
      x: event.clientX,
      y: event.clientY,
    };
  };

  const handleDivisionSelect = (value: DropdownValue): void => {
    const nextDivisions = Number(value);
    if (!divisionsControlAction || !Number.isFinite(nextDivisions)) {
      return;
    }

    onControlChange({
      action: divisionsControlAction,
      deviceId,
      value: nextDivisions,
      finalize: true,
    });
    divisionsMenuPoint = null;
  };

  $effect(() => {
    if (dragTarget) {
      return;
    }

    const nextNodes: CurveNode[] = sanitizeNodes(curve.nodes);
    localNodes = nextNodes;
    if (!nextNodes.some((node) => node.id === selectedNodeId)) {
      selectedNodeId = null;
    }
  });

  $effect(() => {
    const handlePointerMove = (event: PointerEvent): void => {
      if (!pointerSession.matches(event.pointerId) || !dragTarget) {
        return;
      }

      const target = dragTarget;
      if (target.kind === 'node') {
        updateDraggingNode(target.nodeId, event.clientX, event.clientY);
        return;
      }

      if (target.kind === 'node-handle') {
        const index = localNodes.findIndex((node) => node.id === target.nodeId);
        const point = resolvePoint(event.clientX, event.clientY, { snapToDivisions: false, snapToCenterLine: false });
        if (index < 0 || !point) return;
        const kind: HandleKind = index === 0 ? 'handleOut'
          : index === localNodes.length - 1 ? 'handleIn'
            : point.t < localNodes[index].t ? 'handleIn' : 'handleOut';
        updateDraggingHandle(target.nodeId, kind, event, false);
        return;
      }
      updateDraggingHandle(target.nodeId, target.handleKind, event);
    };

    const handlePointerUp = (event: PointerEvent): void => {
      if (!pointerSession.matches(event.pointerId)) {
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

    const handleWindowPointerDown = (event: PointerEvent): void => {
      if (!editorEl) return;
      const target = event.target;
      const isEditorControl = target instanceof Element
        && editorEl.contains(target)
        && target.closest('[data-curve-node-id], [data-bezier-handle]');
      if (isEditorControl) return;
      clearPointerState();
      selectedNodeId = null;
      isKeyboardDeleteEnabled = false;
      lastClickedNodeId = null;
      lastClickedAt = 0;
    };

    window.addEventListener('pointerdown', handleWindowPointerDown, { capture: true });
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    const cancelPointer = (event: PointerEvent): void => {
      if (pointerSession.matches(event.pointerId)) clearPointerState();
    };
    window.addEventListener('pointercancel', cancelPointer);
    window.addEventListener('blur', clearPointerState);
    return () => {
      window.removeEventListener('pointerdown', handleWindowPointerDown, true);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', cancelPointer);
      window.removeEventListener('blur', clearPointerState);
      pointerSession.finish();
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
      style={`--curve-guide-y:${guideValue === null ? '-100%' : `${toPlotY(guideValue).toFixed(3)}%`};`}
      ondblclick={handleEditorDoubleClick}
      oncontextmenu={handleEditorContextMenu}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {#each curveGridLineOffsets as offset (`x:${offset}`)}
          <line class="curve-grid-line" x1={offset} y1="0" x2={offset} y2="100"></line>
        {/each}
        {#if curveFillPath}
          <path class="curve-fill" d={curveFillPath} />
        {/if}
        {#if curveLinePath}
          <path class="curve-line" d={curveLinePath} />
        {/if}
      </svg>
      <BezierHandles handles={plottedHandles} onHandlePointerDown={handleHandlePointerDown} />
      <div class="curve-editor-nodes">
        {#each plottedNodes as node (node.id)}
          {@const nodeLabel = `Curve node at ${node.t.toFixed(3)}, ${node.v.toFixed(3)}`}
          <button
            type="button"
            class="curve-editor-node"
            class:selected={node.id === selectedNodeId}
            data-curve-node-id={node.id}
            style={`left:${node.x}%;top:${node.y}%;`}
            onpointerdown={(event) => handleNodePointerDown(event, node.id)}
            aria-label={nodeLabel}
          ></button>
        {/each}
      </div>
      <div class="curve-editor-playhead" style={`left:${(clampedProgress01 * 100).toFixed(3)}%;`}></div>
    </div>
  </ControlSurfaceFrame>

  <FloatingDropdown
    open={divisionsMenuPoint !== null}
    anchorPoint={divisionsMenuPoint}
    onClose={() => divisionsMenuPoint = null}
  >
    {#if divisionsControlAction}
      <DropdownOptionList
        options={divisionDropdownOptions}
        value={divisions}
        ariaLabel={i18n.t('control.divisions')}
        heading={i18n.t('control.divisions')}
        onSelect={handleDivisionSelect}
        onClose={() => divisionsMenuPoint = null}
      />
    {/if}
  </FloatingDropdown>

</div>
{/snippet}

{#if label}
  <FieldShell {label}>
    {@render curveEditor()}
  </FieldShell>
{:else}
  {@render curveEditor()}
{/if}

<style lang="scss">
  .curve-editor {
    touch-action: none;
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
    border: 1px solid var(--color-border-secondary);
    border-radius: var(--radius-6);
    background:
      linear-gradient(
        to bottom,
        transparent calc(var(--curve-guide-y, -100%) - 0.5px),
        var(--color-border-secondary) calc(var(--curve-guide-y, -100%) - 0.5px),
        var(--color-border-secondary) calc(var(--curve-guide-y, -100%) + 0.5px),
        transparent calc(var(--curve-guide-y, -100%) + 0.5px)
      ),
      var(--color-surface);
    overflow: hidden;

    svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    .curve-grid-line {
      stroke: var(--color-border-tertiary);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }

    .curve-fill {
      fill: color-mix(in oklch, var(--device-control-accent, var(--color-surface-inverse)) 22%, transparent);
    }

    .curve-line {
      fill: none;
      stroke: var(--device-control-accent, var(--color-surface-inverse));
      stroke-width: 2;
      stroke-linejoin: round;
      stroke-linecap: round;
      vector-effect: non-scaling-stroke;
    }

    &-nodes {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }

    &-node {
      position: absolute;
      transform: translate(-50%, -50%);
      padding: 0;
      pointer-events: auto;
      z-index: 2;
      width: 0.8rem;
      height: 0.8rem;
      border: 2px solid var(--color-surface);
      border-radius: var(--radius-round);
      background: var(--color-surface-inverse);
      cursor: pointer;

      &::before {
        content: '';
        position: absolute;
        inset: -0.28rem;
      }

      &.selected {
        background: var(--device-control-accent, var(--color-surface-inverse));
      }
    }

    &-playhead {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 1px;
      background: var(--color-indicator-secondary);
      pointer-events: none;
      transform: translateX(-50%);
    }
  }
</style>
