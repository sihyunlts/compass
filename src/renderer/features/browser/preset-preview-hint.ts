import { evaluateTemporalRemap } from '../../../core/scene-operators/temporal';
import { createSampledRemapFromTimeWarpCurve } from '../../../core/timewarp/curve';
import { createRendererDeviceNode } from '../../../devices';
import {
  cloneDeviceNode,
  isGeneratorDeviceKind,
  isGeneratorNode,
  type GeneratorChain,
  type GeneratorNode,
  type LaunchpadModel,
} from '../../../shared/model';
import type { RackPresetFile } from '../../../shared/presets';
import { resolveLedSurfaceRgb } from '../../app/led-surface-color';
import type { HintInput } from '../../components/overlays/hint';
import { getDeviceMessageKey } from '../../device-i18n';
import { i18n } from '../../i18n.svelte';
import {
  resolvePreviewCellModels,
  resolvePreviewCenterCornerCutClassName,
  type PreviewSurfaceCellModel,
} from '../preview/view-model';
import {
  createPresetPreviewGenerationClient,
  type PresetPreviewLedFrames,
} from './preset-preview-generation-client';
import type {
  BrowserTreeDeviceNode,
  BrowserTreePresetLeafNode,
} from './types';

type PresetPreviewHintNode = BrowserTreeDeviceNode | BrowserTreePresetLeafNode;

const PRESET_PREVIEW_SWATCH_COUNT = 8;
const COLOR_PRESET_PREVIEW_STEP_DURATION_MS = 80;
const PRESET_PREVIEW_EMPTY_COLOR = 'var(--color-surface-floating-interactive)';
const GENERATOR_PRESET_PREVIEW_EMPTY_COLOR = 'var(--color-surface-interactive)';
const TIME_WARP_PRESET_PREVIEW_FRAME_COUNT = 65;
const TIME_WARP_PRESET_PREVIEW_DURATION_MS = 1200;
const TIME_WARP_PRESET_PREVIEW_COLOR_STAGE_FRAME_COUNT = 2;
const TIME_WARP_PRESET_PREVIEW_LED_VELOCITIES = [3, 2, 1] as const;
const GENERATOR_PRESET_PREVIEW_FRAME_COUNT = 65;
const GENERATOR_PRESET_PREVIEW_DURATION_MS = 1200;
const PRESET_PREVIEW_SKELETON_DELAY_MS = 300;

const cancelPresetPreviewAnimations = (
  animations: readonly Animation[],
): void => {
  for (const animation of animations) {
    animation.cancel();
  }
};

const resolvePaletteLedColor = (
  velocity: number,
  resolvePaletteRgb: (velocity: number) => string,
): string => `rgb(${resolveLedSurfaceRgb(resolvePaletteRgb(velocity))})`;

const resolvePresetPreviewSkeletonOrder = (cellIndex: number): number => {
  const row = Math.floor(cellIndex / 10);
  const column = cellIndex % 10;
  return row + column;
};

const schedulePresetPreviewSkeletonActivation = (
  onActivate: () => void,
): (() => void) => {
  const timerId = window.setTimeout(
    onActivate,
    PRESET_PREVIEW_SKELETON_DELAY_MS,
  );
  return () => window.clearTimeout(timerId);
};

const appendPresetPreviewDetails = (
  container: HTMLDivElement,
  detailsText: string | undefined,
  author: string | undefined,
): void => {
  if (!detailsText && !author) {
    return;
  }

  const detailsEl = document.createElement('div');
  detailsEl.className = 'preset-preview-details';
  const accessibleParts: string[] = [];
  if (detailsText) {
    const textEl = document.createElement('span');
    textEl.textContent = detailsText;
    detailsEl.append(textEl);
    accessibleParts.push(detailsText);
  }
  if (author) {
    if (detailsText) {
      const separatorEl = document.createElement('span');
      separatorEl.textContent = '·';
      separatorEl.setAttribute('aria-hidden', 'true');
      detailsEl.append(separatorEl);
    }

    const authorEl = document.createElement('span');
    authorEl.className = 'preset-preview-author';
    const iconEl = document.createElement('span');
    iconEl.className = 'material-symbols-rounded';
    iconEl.textContent = 'person';
    iconEl.setAttribute('aria-hidden', 'true');
    const authorNameEl = document.createElement('span');
    authorNameEl.className = 'preset-preview-author-name';
    authorNameEl.textContent = author;
    authorEl.append(iconEl, authorNameEl);
    detailsEl.append(authorEl);
    accessibleParts.push(`${i18n.t('info.author')}: ${author}`);
  }
  detailsEl.setAttribute('aria-label', accessibleParts.join(', '));
  container.append(detailsEl);
};

const createPresetPreviewLayout = (
  container: HTMLDivElement,
  label: string,
  detailsText: string | undefined,
  author?: string,
): HTMLSpanElement[] => {
  container.style.setProperty(
    '--preset-preview-swatch-count',
    String(PRESET_PREVIEW_SWATCH_COUNT),
  );

  const titleEl = document.createElement('div');
  titleEl.className = 'preset-preview-title';
  titleEl.textContent = label;

  const swatchListEl = document.createElement('div');
  swatchListEl.className = 'preset-preview-swatches';
  swatchListEl.setAttribute('aria-hidden', 'true');

  const swatchElements = Array.from(
    { length: PRESET_PREVIEW_SWATCH_COUNT },
    () => {
      const swatchEl = document.createElement('span');
      swatchEl.className = 'preset-preview-swatch';
      swatchListEl.append(swatchEl);
      return swatchEl;
    },
  );

  container.append(titleEl, swatchListEl);
  appendPresetPreviewDetails(container, detailsText, author);

  return swatchElements;
};

const renderColorPresetPreview = (
  container: HTMLDivElement,
  label: string,
  velocities: readonly number[],
  author: string | undefined,
  resolvePaletteRgb: (velocity: number) => string,
): (() => void) => {
  const animations: Animation[] = [];
  const colorCountText = i18n.t('browser.colorPresetColors', {
    count: velocities.length,
  });
  const swatchElements = createPresetPreviewLayout(
    container,
    label,
    colorCountText,
    author,
  );

  const colors = velocities.map((velocity) =>
    resolvePaletteLedColor(velocity, resolvePaletteRgb));
  const emptyColor = PRESET_PREVIEW_EMPTY_COLOR;
  const animationStepCount = colors.length
    + PRESET_PREVIEW_SWATCH_COUNT
    - 1;

  for (const [slotIndex, swatchEl] of swatchElements.entries()) {
    swatchEl.style.backgroundColor = colors[slotIndex] ?? emptyColor;

    const keyframes = [];
    for (let stepIndex = 0; stepIndex <= animationStepCount; stepIndex += 1) {
      const colorIndex = stepIndex - slotIndex;
      keyframes.push({
        backgroundColor: colors[colorIndex] ?? emptyColor,
        easing: 'steps(1, end)',
        offset: stepIndex / animationStepCount,
      });
    }
    animations.push(
      swatchEl.animate(keyframes, {
        duration: animationStepCount * COLOR_PRESET_PREVIEW_STEP_DURATION_MS,
        iterations: Infinity,
      }),
    );
  }
  return () => cancelPresetPreviewAnimations(animations);
};

const renderTimeWarpPresetPreview = (
  container: HTMLDivElement,
  label: string,
  curve: Extract<BrowserTreePresetLeafNode['preview'], { kind: 'timewarp' }>['curve'],
  author: string | undefined,
  resolvePaletteRgb: (velocity: number) => string,
): (() => void) => {
  const animations: Animation[] = [];
  const swatchElements = createPresetPreviewLayout(
    container,
    label,
    undefined,
    author,
  );
  const remap = createSampledRemapFromTimeWarpCurve(curve);
  const movingSlotByFrame = Array.from(
    { length: TIME_WARP_PRESET_PREVIEW_FRAME_COUNT },
    (_, frameIndex) => {
      const progress = frameIndex / (TIME_WARP_PRESET_PREVIEW_FRAME_COUNT - 1);
      const warpedProgress = evaluateTemporalRemap(remap, progress) ?? 0;
      return Math.round(
        Math.min(Math.max(warpedProgress, 0), 1) * (PRESET_PREVIEW_SWATCH_COUNT - 1),
      );
    },
  );
  const tailFrameCount = TIME_WARP_PRESET_PREVIEW_COLOR_STAGE_FRAME_COUNT
    * TIME_WARP_PRESET_PREVIEW_LED_VELOCITIES.length;
  const activeSlotByFrame: Array<number | null> = [
    ...movingSlotByFrame,
    ...Array.from({ length: tailFrameCount }, (): null => null),
  ];
  const ledColors = TIME_WARP_PRESET_PREVIEW_LED_VELOCITIES.map((velocity) =>
    resolvePaletteLedColor(velocity, resolvePaletteRgb));
  const lastActiveFrameBySlot = Array.from(
    { length: PRESET_PREVIEW_SWATCH_COUNT },
    () => Number.NEGATIVE_INFINITY,
  );
  const slotColorsByFrame = activeSlotByFrame.map((activeSlotIndex, frameIndex) => {
    if (activeSlotIndex !== null) {
      lastActiveFrameBySlot[activeSlotIndex] = frameIndex;
    }

    return Array.from(
      { length: PRESET_PREVIEW_SWATCH_COUNT },
      (_, slotIndex) => {
        const ageInFrames = frameIndex - lastActiveFrameBySlot[slotIndex];
        const colorIndex = Math.floor(
          ageInFrames / TIME_WARP_PRESET_PREVIEW_COLOR_STAGE_FRAME_COUNT,
        );
        return ledColors[colorIndex] ?? PRESET_PREVIEW_EMPTY_COLOR;
      },
    );
  });

  for (const [slotIndex, swatchEl] of swatchElements.entries()) {
    swatchEl.style.backgroundColor = slotColorsByFrame[0][slotIndex];
    animations.push(
      swatchEl.animate(
        slotColorsByFrame.map((slotColors, frameIndex) => ({
          backgroundColor: slotColors[slotIndex],
          easing: 'steps(1, end)',
          offset: frameIndex / (slotColorsByFrame.length - 1),
        })),
        {
          duration: TIME_WARP_PRESET_PREVIEW_DURATION_MS
            * ((slotColorsByFrame.length - 1) / (TIME_WARP_PRESET_PREVIEW_FRAME_COUNT - 1)),
          iterations: Infinity,
        },
      ),
    );
  }
  return () => cancelPresetPreviewAnimations(animations);
};

const resolveGeneratorPreviewCellClassName = (
  cell: PreviewSurfaceCellModel,
): string => [
  'preset-preview-grid-cell',
  cell.pitches.length > 0 ? 'is-button' : '',
  cell.isEdgeButton ? 'is-edge-button' : '',
  cell.isCornerPlaceholder ? 'is-corner-placeholder' : '',
  resolvePreviewCenterCornerCutClassName(cell.key),
].filter(Boolean).join(' ');

const createStandaloneGeneratorPreviewChain = (
  sourceDevice: GeneratorNode,
): GeneratorChain => {
  const device = cloneDeviceNode(sourceDevice);
  device.enabled = true;
  device.groupId = null;
  return {
    devices: [device],
    groupStateById: {},
  };
};

class PresetPreviewHintController {
  private readonly generationClient = createPresetPreviewGenerationClient();

  public dispose(): void {
    this.generationClient.dispose();
  }

  public resolveHint(
    node: PresetPreviewHintNode,
    _paletteRevision: number,
    launchpadModel: LaunchpadModel,
    resolvePaletteRgb: (velocity: number) => string,
    loadRackPreset: (
      entry: BrowserTreePresetLeafNode,
    ) => Promise<RackPresetFile | null>,
  ): HintInput {
    const isDefaultGenerator = node.kind === 'device'
      && isGeneratorDeviceKind(node.deviceKind);
    if (!isDefaultGenerator && (node.kind !== 'preset' || !node.preview)) {
      return null;
    }

    const label = node.kind === 'device'
      ? i18n.t(getDeviceMessageKey(node.deviceKind))
      : node.label;
    return {
      text: label,
      placement: 'adjacent',
      className: 'preset-browser-preview-hint',
      renderContent: (container) => {
        if (node.kind === 'device') {
          const device = createRendererDeviceNode(
            node.deviceKind,
            `browser-preview-${node.deviceKind}`,
          );
          if (isGeneratorNode(device)) {
            return this.renderGeneratorPresetPreview(
              container,
              label,
              device,
              undefined,
              `generator-default:${device.kind}:${launchpadModel}`,
              launchpadModel,
              resolvePaletteRgb,
            );
          }
          return undefined;
        }

        const { preview } = node;
        if (!preview) {
          return undefined;
        }
        if (preview.kind === 'color') {
          return renderColorPresetPreview(
            container,
            label,
            preview.velocities,
            preview.author,
            resolvePaletteRgb,
          );
        }
        if (preview.kind === 'generator') {
          return this.renderGeneratorPresetPreview(
            container,
            label,
            preview.device,
            preview.author,
            `generator-preset:${node.id}:${node.savedAtIso}:${launchpadModel}`,
            launchpadModel,
            resolvePaletteRgb,
          );
        }
        if (preview.kind === 'rack') {
          return this.renderRackPresetPreview(
            container,
            label,
            node,
            preview.author,
            launchpadModel,
            resolvePaletteRgb,
            loadRackPreset,
          );
        }
        return renderTimeWarpPresetPreview(
          container,
          label,
          preview.curve,
          preview.author,
          resolvePaletteRgb,
        );
      },
    };
  }

  private renderSpatialPresetPreview(
    container: HTMLDivElement,
    label: string,
    author: string | undefined,
    cacheKey: string,
    launchpadModel: LaunchpadModel,
    loadSourceChain: () => GeneratorChain | null | Promise<GeneratorChain | null>,
    resolvePaletteRgb: (velocity: number) => string,
  ): () => void {
    let disposed = false;
    let animationFrameId: number | null = null;
    let cancelLoadingStateActivation: (() => void) | null = null;
    const previewCells = resolvePreviewCellModels(launchpadModel);
    container.classList.add('is-generator-preview');
    container.style.setProperty(
      '--preset-preview-swatch-count',
      String(PRESET_PREVIEW_SWATCH_COUNT),
    );

    const titleEl = document.createElement('div');
    titleEl.className = 'preset-preview-title';
    titleEl.textContent = label;

    const gridEl = document.createElement('div');
    gridEl.className = 'preset-preview-grid';
    gridEl.setAttribute('aria-hidden', 'true');
    const cellElements = Array.from(
      previewCells,
      (cell, cellIndex) => {
        const cellEl = document.createElement('span');
        cellEl.className = resolveGeneratorPreviewCellClassName(cell);
        cellEl.style.setProperty(
          '--preset-preview-skeleton-order',
          String(resolvePresetPreviewSkeletonOrder(cellIndex)),
        );
        gridEl.append(cellEl);
        return cellEl;
      },
    );

    container.append(titleEl, gridEl);
    appendPresetPreviewDetails(container, undefined, author);

    const stopLoadingState = (): void => {
      if (cancelLoadingStateActivation) {
        cancelLoadingStateActivation();
        cancelLoadingStateActivation = null;
      }
      gridEl.classList.remove('is-preview-loading');
    };

    const renderGeneratedFrames = (
      sourceFrames: PresetPreviewLedFrames,
    ): void => {
      if (disposed || !container.isConnected) {
        return;
      }
      stopLoadingState();
      if (sourceFrames.length === 0) {
        return;
      }

      const cellColorsByFrame = sourceFrames.map((frame) => {
        const velocityByPitch: Record<number, number> = {};
        for (const [pitch, velocity] of frame) {
          velocityByPitch[pitch] = velocity;
        }
        return previewCells.map((cell) => {
          let color = cell.pitches.length > 0
            ? GENERATOR_PRESET_PREVIEW_EMPTY_COLOR
            : 'transparent';
          for (const pitch of cell.pitches) {
            const velocity = velocityByPitch[pitch];
            if (velocity !== undefined) {
              color = resolvePaletteLedColor(velocity, resolvePaletteRgb);
            }
          }
          return color;
        });
      });
      const applyFrame = (frame: readonly string[]): void => {
        for (const [cellIndex, cellEl] of cellElements.entries()) {
          if (cellEl.style.backgroundColor !== frame[cellIndex]) {
            cellEl.style.backgroundColor = frame[cellIndex];
          }
        }
      };
      applyFrame(cellColorsByFrame[0]);

      let previousFrameIndex = -1;
      const startedAt = performance.now();
      const renderAnimationFrame = (timestamp: number): void => {
        if (disposed) {
          return;
        }
        const elapsed = (timestamp - startedAt) % GENERATOR_PRESET_PREVIEW_DURATION_MS;
        const frameIndex = Math.min(
          Math.floor(
            (elapsed / GENERATOR_PRESET_PREVIEW_DURATION_MS)
              * cellColorsByFrame.length,
          ),
          cellColorsByFrame.length - 1,
        );
        if (frameIndex !== previousFrameIndex) {
          applyFrame(cellColorsByFrame[frameIndex]);
          previousFrameIndex = frameIndex;
        }
        animationFrameId = window.requestAnimationFrame(renderAnimationFrame);
      };
      animationFrameId = window.requestAnimationFrame(renderAnimationFrame);
    };

    const cachedFrames = this.generationClient.getCached(cacheKey);
    if (cachedFrames) {
      renderGeneratedFrames(cachedFrames);
    } else {
      cancelLoadingStateActivation = schedulePresetPreviewSkeletonActivation(() => {
        cancelLoadingStateActivation = null;
        if (!disposed && container.isConnected) {
          gridEl.classList.add('is-preview-loading');
        }
      });
      void Promise.resolve(loadSourceChain()).then((sourceChain) => {
        if (disposed || !sourceChain) {
          stopLoadingState();
          return null;
        }
        return this.generationClient.generate({
          cacheKey,
          sourceChain,
          frameCount: GENERATOR_PRESET_PREVIEW_FRAME_COUNT,
          launchpadModel,
        });
      }).then((ledFrames) => {
        if (ledFrames) {
          renderGeneratedFrames(ledFrames);
        }
      }).catch((): void => {
        stopLoadingState();
      });
    }

    return () => {
      disposed = true;
      stopLoadingState();
      this.generationClient.cancel();
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }

  private renderGeneratorPresetPreview(
    container: HTMLDivElement,
    label: string,
    sourceDevice: GeneratorNode,
    author: string | undefined,
    cacheKey: string,
    launchpadModel: LaunchpadModel,
    resolvePaletteRgb: (velocity: number) => string,
  ): () => void {
    return this.renderSpatialPresetPreview(
      container,
      label,
      author,
      cacheKey,
      launchpadModel,
      () => createStandaloneGeneratorPreviewChain(sourceDevice),
      resolvePaletteRgb,
    );
  }

  private renderRackPresetPreview(
    container: HTMLDivElement,
    label: string,
    node: BrowserTreePresetLeafNode,
    author: string | undefined,
    launchpadModel: LaunchpadModel,
    resolvePaletteRgb: (velocity: number) => string,
    loadRackPreset: (
      entry: BrowserTreePresetLeafNode,
    ) => Promise<RackPresetFile | null>,
  ): () => void {
    return this.renderSpatialPresetPreview(
      container,
      label,
      author,
      `rack:${node.id}:${node.savedAtIso}:${launchpadModel}`,
      launchpadModel,
      async () => {
        const preset = await loadRackPreset(node);
        return preset?.chain ?? null;
      },
      resolvePaletteRgb,
    );
  }
}

export const createPresetPreviewHintController =
  (): PresetPreviewHintController => new PresetPreviewHintController();
