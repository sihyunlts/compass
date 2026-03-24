import { clamp } from '../../../shared/math';
import type { GeneratorChain, LaunchpadModel } from '../../../shared/model';
import type { GeneratorPreview } from '../../../shared/contracts/preview/generator-preview';
import type { PreviewWindowState } from '../../../shared/contracts/preview/window-state';
import { createModulationReadoutCache } from './modulation-cache';
import {
  createPreviewResultCache,
  type PreviewResultCacheEntry,
} from './result-cache';
import { toActiveCells } from './utils';
import {
  DEFAULT_OVERLAY_WORLD_BOUNDS,
  buildPreviewSurfaceViewModel,
  createEmptyPreviewSurfaceViewModel,
  type PreviewSurfaceViewModel,
} from './view-model';

interface AppliedPreviewSource {
  previewKey: string;
  sourceKey: string;
  sourceChain: GeneratorChain;
  previewRevision: number;
}

interface PreviewGenerateInput {
  sourceChain: GeneratorChain;
  sourceKey: string;
  loopLengthBeats: number;
  launchpadModel: LaunchpadModel;
}

interface PreviewApplyInput extends PreviewGenerateInput {
  preview: GeneratorPreview;
}

interface PreviewFrameInput {
  fallbackChain: GeneratorChain;
  fallbackKey: string;
  launchpadModel: LaunchpadModel;
  currentBeat: number;
  loopLengthBeats: number;
  bpm: number;
  isPlaying: boolean;
  isLoopEnabled: boolean;
  isGuideEnabled: boolean;
  resolveLedRgb: (velocity: number) => string;
}

interface PreviewSessionState {
  previewWindowState: PreviewWindowState | null;
  surfaceModel: PreviewSurfaceViewModel;
  modulationReadoutById: Record<string, string>;
  previewRevision: number;
  sourceTimelineEndBeat: number;
  noteCount: number;
  uniquePitchCount: number;
}

export class PreviewSession {
  public readonly state: PreviewSessionState = $state({
    previewWindowState: null,
    surfaceModel: createEmptyPreviewSurfaceViewModel(),
    modulationReadoutById: {},
    previewRevision: 0,
    sourceTimelineEndBeat: 1,
    noteCount: 0,
    uniquePitchCount: 0,
  });

  private currentPreviewSource: AppliedPreviewSource | null = null;

  private nextPreviewRevision = 1;

  private readonly previewResultCache = createPreviewResultCache();

  private readonly modulationReadoutCache = createModulationReadoutCache();

  public readonly commands = {
    generateRendererPreview: (input: PreviewGenerateInput): GeneratorPreview => {
      const preview = this.previewResultCache.resolve(input).preview;
      if (!preview) {
        throw new Error('Renderer preview generation returned no preview');
      }
      return preview;
    },
    applyPreviewResult: (input: PreviewApplyInput): void => {
      this.applyPreviewResult(input);
    },
    renderFrame: (input: PreviewFrameInput): PreviewWindowState => this.renderFrame(input),
    applyWindowState: (previewState: PreviewWindowState | null): void => {
      this.applyWindowState(previewState);
    },
    clearAppliedPreview: (): void => {
      this.resetAppliedPreview();
    },
    resetCaches: (): void => {
      this.resetCaches();
    },
  };

  private applyPreviewResult(input: PreviewApplyInput): void {
    const previewResult = this.previewResultCache.resolve(input);
    const previewRevision = this.nextPreviewRevision;
    this.nextPreviewRevision += 1;

    this.currentPreviewSource = {
      previewKey: previewResult.key,
      sourceKey: input.sourceKey,
      sourceChain: input.sourceChain,
      previewRevision,
    };
    this.syncPreviewMetrics(previewResult, previewRevision);
  }

  private renderFrame(input: PreviewFrameInput): PreviewWindowState {
    const { previewResult, previewRevision, sourceChain, sourceKey } =
      this.resolveRenderSource(input);
    const sourceTimelineEndBeat = previewResult?.sourceTimelineEndBeat ?? 1;
    const beat = clamp(input.currentBeat, 0, sourceTimelineEndBeat);
    const activeVelocityByPitch = this.previewResultCache.resolveActiveVelocityByPitchAtBeat(
      previewResult,
      beat,
    );

    const previewWindowState: PreviewWindowState = {
      activeCells: toActiveCells(activeVelocityByPitch, input.resolveLedRgb),
      previewRevision,
      chain: sourceChain,
      launchpadModel: input.launchpadModel,
      currentBeat: beat,
      sourceTimelineEndBeat,
      loopLengthBeats: input.loopLengthBeats,
      noteCount: previewResult?.preview?.noteCount ?? 0,
      uniquePitchCount: previewResult?.preview?.uniquePitchCount ?? 0,
      bpm: input.bpm,
      isPlaying: input.isPlaying,
      isLoopEnabled: input.isLoopEnabled,
      isGuideEnabled: input.isGuideEnabled,
    };

    this.syncPreviewSurface(
      previewWindowState,
      previewResult?.overlayFramesByIndex ?? [],
      previewResult?.overlayWorldBounds ?? DEFAULT_OVERLAY_WORLD_BOUNDS,
    );
    this.state.modulationReadoutById = this.modulationReadoutCache.resolveReadoutById(
      sourceKey,
      sourceChain,
      beat,
      input.loopLengthBeats,
      input.isLoopEnabled,
    );
    this.state.previewRevision = previewRevision;
    this.state.sourceTimelineEndBeat = sourceTimelineEndBeat;
    this.state.noteCount = previewWindowState.noteCount;
    this.state.uniquePitchCount = previewWindowState.uniquePitchCount;
    return previewWindowState;
  }

  private applyWindowState(previewState: PreviewWindowState | null): void {
    this.currentPreviewSource = null;
    this.state.modulationReadoutById = {};

    if (!previewState) {
      this.resetAppliedPreview();
      return;
    }

    const previewResult = this.previewResultCache.resolve({
      sourceChain: previewState.chain,
      sourceKey: `preview-window:${previewState.previewRevision}`,
      loopLengthBeats: previewState.loopLengthBeats,
      launchpadModel: previewState.launchpadModel ?? 'mk3',
    });
    this.syncPreviewSurface(
      previewState,
      previewResult.overlayFramesByIndex,
      previewResult.overlayWorldBounds,
    );
    this.state.previewRevision = previewState.previewRevision;
    this.state.sourceTimelineEndBeat = previewState.sourceTimelineEndBeat;
    this.state.noteCount = previewState.noteCount;
    this.state.uniquePitchCount = previewState.uniquePitchCount;
  }

  private resetAppliedPreview(): void {
    this.currentPreviewSource = null;
    this.state.previewWindowState = null;
    this.state.surfaceModel = createEmptyPreviewSurfaceViewModel();
    this.state.modulationReadoutById = {};
    this.state.previewRevision = 0;
    this.state.sourceTimelineEndBeat = 1;
    this.state.noteCount = 0;
    this.state.uniquePitchCount = 0;
  }

  private resetCaches(): void {
    this.previewResultCache.reset();
    this.modulationReadoutCache.reset();
  }

  private syncPreviewMetrics(
    previewResult: PreviewResultCacheEntry,
    previewRevision: number,
  ): void {
    this.state.previewRevision = previewRevision;
    this.state.sourceTimelineEndBeat = previewResult.sourceTimelineEndBeat;
    this.state.noteCount = previewResult.preview?.noteCount ?? 0;
    this.state.uniquePitchCount = previewResult.preview?.uniquePitchCount ?? 0;
  }

  private resolveRenderSource(input: PreviewFrameInput): {
    previewResult: PreviewResultCacheEntry | null;
    previewRevision: number;
    sourceChain: GeneratorChain;
    sourceKey: string;
  } {
    const previewSource = this.currentPreviewSource;
    return {
      previewResult: previewSource
        ? this.previewResultCache.require(previewSource.previewKey)
        : null,
      previewRevision: previewSource?.previewRevision ?? 0,
      sourceChain: previewSource?.sourceChain ?? input.fallbackChain,
      sourceKey: previewSource?.sourceKey ?? input.fallbackKey,
    };
  }

  private syncPreviewSurface(
    previewState: PreviewWindowState | null,
    overlayFramesByIndex: Parameters<typeof buildPreviewSurfaceViewModel>[1],
    overlayBounds: Parameters<typeof buildPreviewSurfaceViewModel>[2],
  ): void {
    this.state.previewWindowState = previewState;
    this.state.surfaceModel = buildPreviewSurfaceViewModel(
      previewState,
      overlayFramesByIndex,
      overlayBounds,
    );
  }
}

export const createPreviewSession = (): PreviewSession => new PreviewSession();
