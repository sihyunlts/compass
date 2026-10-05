<svelte:options runes={true} />

<script lang="ts">
  import { touchGestures } from '../../features/touch-gestures';
  import { IDENTITY_PATH_TRANSFORM } from '../../../devices/path/schema';
  import type { PathAnchor } from '../../../shared/model';
  import { i18n } from '../../i18n.svelte';
  import ControlSurfaceFrame from './ControlSurfaceFrame.svelte';
  import BezierHandles from './BezierHandles.svelte';
  import { createPathEditorController } from './path-editor-controller.svelte';
  import type { PathEditorProps } from './path-editor-types';

  let {
    deviceId,
    anchors = [] as PathAnchor[],
    closed = false,
    fill = false,
    transform = IDENTITY_PATH_TRANSFORM,
    readonly = false,
    previewProgress01 = null,
    previewDirection = 'forward',
    previewStartAnchorId = '',
    selectedAnchorId = null,
    onAnchorSelect,
    onControlChange,
  }: PathEditorProps = $props();

  const editor = createPathEditorController({
    get deviceId() { return deviceId; },
    get anchors() { return anchors; },
    get closed() { return closed; },
    get transform() { return transform; },
    get readonly() { return readonly; },
    get previewProgress01() { return previewProgress01; },
    get previewDirection() { return previewDirection; },
    get previewStartAnchorId() { return previewStartAnchorId; },
    get selectedAnchorId() { return selectedAnchorId; },
    get onControlChange() { return onControlChange; },
  });
</script>

<ControlSurfaceFrame>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="path-editor-surface"
      use:touchGestures={{ contextMenu: false, enabled: !readonly }}
      class:is-drawing={!readonly}
      bind:this={editor.element}
      tabindex="-1"
      onpointerdown={editor.handleSurfacePointerDown}
      ondblclick={editor.handleSurfaceDoubleClick}
      onkeydown={editor.handleEditorKeyDown}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {#each editor.view.gridLineOffsets as offset (`x:${offset}`)}
          <line class="path-editor-grid-line" x1={offset} y1="0" x2={offset} y2="100"></line>
        {/each}
        {#each editor.view.gridLineOffsets as offset (`y:${offset}`)}
          <line class="path-editor-grid-line" x1="0" y1={offset} x2="100" y2={offset}></line>
        {/each}
        {#if editor.view.plottedAlignmentGuides.x !== null}
          <line
            class="path-editor-alignment-guide"
            x1={editor.view.plottedAlignmentGuides.x}
            y1="0"
            x2={editor.view.plottedAlignmentGuides.x}
            y2="100"
          ></line>
        {/if}
        {#if editor.view.plottedAlignmentGuides.y !== null}
          <line
            class="path-editor-alignment-guide"
            x1="0"
            y1={editor.view.plottedAlignmentGuides.y}
            x2="100"
            y2={editor.view.plottedAlignmentGuides.y}
          ></line>
        {/if}

        {#if editor.view.combinedPath}
          <path class="path-editor-fill" class:is-visible={fill && editor.closed} d={`${editor.view.combinedPath} Z`}></path>
        {/if}
        {#each editor.view.segments as segment (segment.index)}
          <path class="path-editor-line" d={segment.d}></path>
          {#if !readonly}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <path
              class="path-editor-hit-path path-editor-interactive"
              use:touchGestures={{ contextMenu: false }}
              d={segment.d}
              onpointerdown={editor.beginPathMove}
              ondblclick={(event) => editor.handleSegmentDoubleClick(event, segment.index)}
            ></path>
          {/if}
        {/each}
        {#if editor.view.pathSelection}
          <polygon
            class="path-editor-selection-box"
            points={editor.view.pathSelection.polygon}
          ></polygon>
        {/if}
        {#if editor.view.marqueeBox}
          <rect
            class="path-editor-marquee"
            x={editor.view.marqueeBox.left}
            y={editor.view.marqueeBox.top}
            width={editor.view.marqueeBox.width}
            height={editor.view.marqueeBox.height}
          ></rect>
        {/if}
      </svg>

      <BezierHandles
        handles={editor.view.selectedHandles}
        onHandlePointerDown={editor.handleBezierHandlePointerDown}
      />

      {#if editor.view.pathSelection}
        {#each editor.view.pathSelection.scaleHandles as handle (handle.id)}
          <button
            type="button"
            class={`path-editor-rotation-zone path-editor-interactive is-${handle.rotationPosition}`}
            class:is-inside={handle.rotationZoneInside}
            style={`left:${handle.x}%;top:${handle.y}%;cursor:${handle.rotationCursor};`}
            aria-label={i18n.t('control.rotation')}
            onpointerdown={editor.beginPathRotation}
          ></button>
          <button
            type="button"
            class="path-editor-scale-handle path-editor-interactive"
            style={`left:${handle.x}%;top:${handle.y}%;cursor:${handle.cursor};`}
            aria-label={i18n.t('device.scale')}
            onpointerdown={(event) => editor.beginPathScale(event, handle)}
          ></button>
        {/each}
      {/if}
      {#if !readonly || onAnchorSelect}
        {#each editor.view.plottedAnchors as anchor (anchor.id)}
          <button
            type="button"
            class="path-editor-anchor path-editor-interactive"
            use:touchGestures={{ contextMenu: false, enabled: !readonly }}
            class:is-selected={anchor.selected}
            class:is-animation-start={readonly && selectedAnchorId === anchor.id}
            class:is-merge-target={anchor.mergeTarget}
            class:is-drawing-endpoint={editor.drawingEndpoint === 'start' && anchor.index === 0 || editor.drawingEndpoint === 'end' && anchor.index === editor.anchors.length - 1}
            style={`left:${anchor.x}%;top:${anchor.y}%;`}
            aria-label={readonly && onAnchorSelect
              ? i18n.t('control.pathAnimationStartAnchor', { index: anchor.index + 1 })
              : i18n.t('control.pathAnchor', { index: anchor.index + 1 })}
            aria-pressed={readonly && onAnchorSelect
              ? selectedAnchorId === anchor.id
              : undefined}
            onpointerdown={(event) => {
              if (!readonly) {
                editor.handleAnchorPointerDown(event, anchor.id);
              }
            }}
            onclick={(event) => {
              if (readonly && onAnchorSelect) {
                event.stopPropagation();
                onAnchorSelect(anchor.id);
              }
            }}
            ondblclick={(event) => editor.handleAnchorDoubleClick(event, anchor.id)}
          ></button>
        {/each}
      {/if}

      {#if editor.view.previewPoint}
        <span
          class="path-editor-preview-point"
          style={`left:${editor.view.previewPoint.x}%;top:${editor.view.previewPoint.y}%;`}
          aria-hidden="true"
        ></span>
      {/if}
    </div>
</ControlSurfaceFrame>

<style lang="scss">
  .path-editor-surface {
    touch-action: none;
    position: relative;
    aspect-ratio: 1 / 1;
    overflow: hidden;
    border: 1px solid var(--color-border-secondary);
    border-radius: var(--radius-6);
    background: var(--color-surface);
    cursor: default;

    &.is-drawing {
      cursor: crosshair;
    }

    svg {
      position: absolute;
      inset: 0;
      display: block;
      width: 100%;
      height: 100%;
    }
  }

  .path-editor-grid-line {
    stroke: var(--color-border-tertiary);
    stroke-width: 0.6;
    vector-effect: non-scaling-stroke;
  }

  .path-editor-alignment-guide {
    stroke: var(--device-control-accent, var(--color-surface-inverse));
    stroke-width: 1;
    pointer-events: none;
    vector-effect: non-scaling-stroke;
  }

  .path-editor-fill {
    fill: transparent;
    stroke: none;

    &.is-visible {
      fill: color-mix(in oklch, var(--device-control-accent, var(--color-surface-inverse)) 22%, transparent);
    }
  }

  .path-editor-line {
    fill: none;
    stroke: var(--device-control-accent, var(--color-surface-inverse));
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }

  .path-editor-hit-path {
    fill: none;
    stroke: transparent;
    stroke-width: 12;
    cursor: move;
    vector-effect: non-scaling-stroke;
  }

  .path-editor-selection-box,
  .path-editor-marquee {
    fill: none;
    stroke: var(--device-control-accent, var(--color-surface-inverse));
    stroke-width: 1;
    pointer-events: none;
    vector-effect: non-scaling-stroke;
  }

  .path-editor-selection-box {
    stroke-dasharray: 3 2;
  }

  .path-editor-marquee {
    fill: color-mix(in oklch, var(--device-control-accent, var(--color-surface-inverse)) 12%, transparent);
    stroke-dasharray: 2 1;
  }

  .path-editor-anchor,
  .path-editor-scale-handle {
    position: absolute;
    transform: translate(-50%, -50%);
    border-radius: var(--radius-round);
  }

  .path-editor-anchor {
    width: 0.8rem;
    height: 0.8rem;
    padding: 0;
    border: 2px solid var(--color-surface);
    background: var(--color-surface-inverse);
    cursor: grab;

    &:active {
      cursor: grabbing;
    }

    &.is-selected,
    &.is-drawing-endpoint,
    &.is-merge-target,
    &.is-animation-start {
      background: var(--device-control-accent, var(--color-surface-inverse));
      box-shadow: 0 0 0 1px var(--color-text-primary);
    }

    &.is-animation-start {
      box-shadow: 0 0 0 2px var(--color-text-primary);
    }
  }

  .path-editor-rotation-zone {
    position: absolute;
    z-index: 1;
    width: 8%;
    height: 8%;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;

    &.is-north-west {
      transform: translate(-100%, -100%);
    }

    &.is-north-east {
      transform: translate(0, -100%);
    }

    &.is-south-east {
      transform: translate(0, 0);
    }

    &.is-south-west {
      transform: translate(-100%, 0);
    }

    &.is-north-west.is-inside {
      transform: translate(0, 0);
    }

    &.is-north-east.is-inside {
      transform: translate(-100%, 0);
    }

    &.is-south-east.is-inside {
      transform: translate(-100%, -100%);
    }

    &.is-south-west.is-inside {
      transform: translate(0, -100%);
    }
  }

  .path-editor-scale-handle {
    z-index: 2;
    width: 0.58rem;
    height: 0.58rem;
    padding: 0;
    border: 1px solid var(--device-control-accent, var(--color-surface-inverse));
    border-radius: 0;
    background: var(--color-surface);
  }

  .path-editor-preview-point {
    position: absolute;
    width: 0.72rem;
    height: 0.72rem;
    border: 2px solid var(--color-surface);
    border-radius: var(--radius-2);
    background: var(--device-control-accent, var(--color-surface-inverse));
    pointer-events: none;
    transform: translate(-50%, -50%) rotate(45deg);
  }
</style>
