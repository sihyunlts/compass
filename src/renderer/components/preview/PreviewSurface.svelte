<script lang="ts">
  /** Renders Launchpad preview cells for rack and popout modes. */
  import { SvelteMap } from "svelte/reactivity";

  import {
    createEmptyPreviewSurfaceViewModel,
    type PreviewSurfaceViewModel,
  } from "../../features/preview/view-model";

  type PreviewSurfaceMode = "rack" | "popout";

  let {
    surfaceModel = createEmptyPreviewSurfaceViewModel(),
    mode = "rack",
    sizePx = null,
  } = $props<{
      surfaceModel?: PreviewSurfaceViewModel;
      mode: PreviewSurfaceMode;
      sizePx?: number | null;
    }>();

  let surfaceHeight = $state(0);
  const surfaceSize = $derived(
    mode === "popout" && sizePx !== null && sizePx > 0
      ? sizePx
      : surfaceHeight,
  );
  const surfaceScale = $derived(
    mode === "popout" && surfaceSize > 0
      ? Math.min(Math.max(surfaceSize / 280, 1), 3)
      : 1,
  );
  const surfaceStyle = $derived.by(() => {
    if (surfaceSize <= 0) {
      return `--preview-surface-scale:${surfaceScale.toFixed(3)};`;
    }

    if (mode === "popout") {
      return [
        `width: ${surfaceSize}px`,
        `height: ${surfaceSize}px`,
        `--preview-surface-scale:${surfaceScale.toFixed(3)}`,
      ].join(";");
    }

    return `width: ${surfaceHeight}px`;
  });

  const resolveLedRgbByCellKey = (
    nextSurfaceModel: PreviewSurfaceViewModel,
  ): SvelteMap<string, string> => {
    const rgbByPitch = new SvelteMap<number, string>();
    for (const cell of nextSurfaceModel.activeCells) {
      rgbByPitch.set(cell.pitch, cell.rgb);
    }

    const rgbByCellKey = new SvelteMap<string, string>();
    for (const cell of nextSurfaceModel.cells) {
      for (const pitch of cell.pitches) {
        const rgb = rgbByPitch.get(pitch);
        if (!rgb) {
          continue;
        }
        rgbByCellKey.set(cell.key, rgb);
      }
    }

    return rgbByCellKey;
  };

  const ledRgbByCellKey = $derived.by(() =>
    resolveLedRgbByCellKey(surfaceModel),
  );

  const resolveCenterCornerCutClass = (cellKey: string): string => {
    if (cellKey === "4:4") {
      return "is-center-corner-bottom-right";
    }
    if (cellKey === "4:5") {
      return "is-center-corner-bottom-left";
    }
    if (cellKey === "5:4") {
      return "is-center-corner-top-right";
    }
    if (cellKey === "5:5") {
      return "is-center-corner-top-left";
    }
    return "";
  };
</script>

<div
  class="preview-launchpad"
  class:mode-popout={mode === "popout"}
  bind:clientHeight={surfaceHeight}
  style={surfaceStyle}
  role="img"
  aria-label="Launchpad LED preview"
>
  {#each surfaceModel.cells as cell (cell.key)}
    {@const ledRgb = ledRgbByCellKey.get(cell.key)}
    <div
      class={`preview-button ${resolveCenterCornerCutClass(cell.key)}`}
      class:is-button={cell.pitches.length > 0}
      class:is-edge-button={cell.isEdgeButton}
      class:is-corner-placeholder={cell.isCornerPlaceholder}
      class:is-lit={ledRgb !== undefined}
      style={ledRgb ? `--led-rgb: ${ledRgb}` : ""}
    ></div>
  {/each}
</div>

<style lang="scss">
  .preview-launchpad {
    --preview-border-width: 1px;
    --preview-gap: var(--gap-2);
    --preview-padding: var(--gap-8);
    --preview-edge-inset: var(--gap-2);
    --preview-radius: var(--radius-4);

    border: var(--preview-border-width) solid var(--neutral-20);
    border-radius: var(--preview-radius);
    background: var(--neutral-00);
    flex: 1;
    display: grid;
    grid-template-columns: repeat(10, minmax(0, 1fr));
    grid-template-rows: repeat(10, minmax(0, 1fr));
    gap: var(--preview-gap);
    padding: var(--preview-padding);

    &.mode-popout {
      --preview-border-width: max(1px, calc(1px * var(--preview-surface-scale)));
      --preview-gap: calc(var(--gap-2) * var(--preview-surface-scale));
      --preview-padding: calc(var(--gap-8) * var(--preview-surface-scale));
      --preview-edge-inset: calc(var(--gap-2) * var(--preview-surface-scale));
      --preview-radius: calc(var(--radius-4) * var(--preview-surface-scale));

      flex: 0 0 auto;
      min-height: 0;
      max-width: 100%;
      max-height: 100%;
      align-self: center;
    }
  }

  .preview-button {
    --center-corner-cut-size: 15%;

    border-radius: var(--radius-percent-3);

    &.is-button {
      background: var(--neutral-20);

      &.is-edge-button {
        position: relative;
        overflow: hidden;

        &::after {
          content: "";
          position: absolute;
          inset: var(--preview-edge-inset);
          background: var(--neutral-00);
          pointer-events: none;
        }
      }

      &.is-corner-placeholder {
        width: 50%;
        height: 50%;
        align-self: center;
        justify-self: center;
      }

      &.is-lit {
        background: rgb(var(--led-rgb, var(--rgb-led-default)));
      }

      &.is-center-corner-bottom-right {
        clip-path: polygon(
          0 0,
          100% 0,
          100% calc(100% - var(--center-corner-cut-size)),
          calc(100% - var(--center-corner-cut-size)) 100%,
          0 100%
        );
      }

      &.is-center-corner-bottom-left {
        clip-path: polygon(
          0 0,
          100% 0,
          100% 100%,
          var(--center-corner-cut-size) 100%,
          0 calc(100% - var(--center-corner-cut-size))
        );
      }

      &.is-center-corner-top-right {
        clip-path: polygon(
          0 0,
          calc(100% - var(--center-corner-cut-size)) 0,
          100% var(--center-corner-cut-size),
          100% 100%,
          0 100%
        );
      }

      &.is-center-corner-top-left {
        clip-path: polygon(
          var(--center-corner-cut-size) 0,
          100% 0,
          100% 100%,
          0 100%,
          0 var(--center-corner-cut-size)
        );
      }
    }
  }
</style>
