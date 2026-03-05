import { SvelteMap } from 'svelte/reactivity';

import {
  generateNotes,
  generateOverlayFrames,
  generatePreviewStats,
  type OverlayFrameStroke,
} from '../../../domain';
import {
  type CompiledModulationProgram,
  compileModulationProgram,
  evaluateModulationProgramReadouts,
} from '../../../core/modulation/compiled-program';
import { clamp } from '../../../shared/math';
import type {
  GeneratorChain,
  GeneratorPreview,
  LaunchpadModel,
  PreviewWindowState,
} from '../../../shared/types';
import {
  PREVIEW_FRAME_COUNT,
  toPreviewFrameBeat,
  toPreviewFrameIndex,
} from '../../services/preview-cache';
import {
  buildPreviewSurfaceViewModel,
  createEmptyPreviewSurfaceViewModel,
  resolveOverlayWorldBounds,
  type OverlayWorldBounds,
  type PreviewSurfaceViewModel,
} from './view-model';

const OVERLAY_SAMPLE_STEP = 0.25;
const OVERLAY_WORLD_BASE_PADDING = 4;
const OVERLAY_WORLD_PADDING_STEP = 2;
const OVERLAY_WORLD_MAX_PADDING = 14;
const PREVIEW_FRAME_BEATS = Array.from(
  { length: PREVIEW_FRAME_COUNT },
  (_, index) => toPreviewFrameBeat(index),
);

const EMPTY_ACTIVE_VELOCITY_BY_PITCH = new SvelteMap<number, number>();
const EMPTY_MODULATION_READOUT_BY_ID: Readonly<Record<string, string>> = Object.freeze({});

interface PreviewResultCacheEntry {
  key: string;
  preview: GeneratorPreview | null;
  sourceTimelineEndBeat: number;
  ledFramesByIndex: ReadonlyArray<ReadonlyMap<number, number>>;
}

interface OverlayCacheEntry {
  key: string;
  bounds: OverlayWorldBounds;
  framesByIndex: ReadonlyArray<ReadonlyArray<OverlayFrameStroke>>;
}

interface ModulationCacheEntry {
  key: string;
  program: CompiledModulationProgram;
  baselineById: Readonly<Record<string, string>>;
  modulatorIds: readonly string[];
}

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

export interface PreviewSessionState {
  previewWindowState: PreviewWindowState | null;
  surfaceModel: PreviewSurfaceViewModel;
  modulationReadoutById: Record<string, string>;
  previewRevision: number;
  sourceTimelineEndBeat: number;
  noteCount: number;
  uniquePitchCount: number;
}

const resolveSourceTimelineEnd = (preview: GeneratorPreview | null): number => {
  if (!preview) {
    return 1;
  }

  let maxEndBeat = 1;
  for (const note of preview.notes) {
    const startBeat = Number.isFinite(note.startBeat) ? note.startBeat : 0;
    const durationBeats = Number.isFinite(note.durationBeats) ? note.durationBeats : 0;
    const endBeat = Math.max(0, startBeat + Math.max(durationBeats, 0));
    if (endBeat > maxEndBeat) {
      maxEndBeat = endBeat;
    }
  }

  return Number.isFinite(maxEndBeat) && maxEndBeat >= 1 ? maxEndBeat : 1;
};

const collectActiveVelocityByPitch = (
  preview: GeneratorPreview | null,
  beat: number,
): SvelteMap<number, number> => {
  const active = new SvelteMap<number, number>();

  if (!preview) {
    return active;
  }

  for (const note of preview.notes) {
    const startBeat = note.startBeat;
    const endBeat = note.startBeat + note.durationBeats;
    if (beat < startBeat || beat >= endBeat) {
      continue;
    }

    const previous = active.get(note.pitch);
    if (previous === undefined || note.velocity > previous) {
      active.set(note.pitch, note.velocity);
    }
  }

  return active;
};

const buildLedFrameCache = (
  preview: GeneratorPreview | null,
  timelineSpanBeats: number,
): ReadonlyArray<ReadonlyMap<number, number>> => {
  if (!preview) {
    return [];
  }

  const frames: Array<ReadonlyMap<number, number>> = [];
  for (let index = 0; index < PREVIEW_FRAME_COUNT; index += 1) {
    frames.push(
      collectActiveVelocityByPitch(
        preview,
        toPreviewFrameBeat(index, timelineSpanBeats),
      ),
    );
  }
  return frames;
};

const toWrappedLoopBeat01 = (beat: number): number => {
  const safeBeat = Number.isFinite(beat) ? beat : 0;
  const wrapped = ((safeBeat % 1) + 1) % 1;
  if (wrapped === 0 && safeBeat > 0) {
    return 1;
  }
  return wrapped;
};

const touchesOverlayBoundary = (
  strokes: ReadonlyArray<OverlayFrameStroke>,
  bounds: OverlayWorldBounds,
): boolean => {
  if (strokes.length === 0) {
    return false;
  }

  const edgeMargin = OVERLAY_SAMPLE_STEP * 1.1;
  const minXEdge = bounds.minX + edgeMargin;
  const maxXEdge = bounds.maxX - edgeMargin;
  const minYEdge = bounds.minY + edgeMargin;
  const maxYEdge = bounds.maxY - edgeMargin;

  for (const stroke of strokes) {
    for (const point of stroke.points) {
      if (
        point.x <= minXEdge
        || point.x >= maxXEdge
        || point.y <= minYEdge
        || point.y >= maxYEdge
      ) {
        return true;
      }
    }
  }

  return false;
};

const touchesOverlayFrameCacheBoundary = (
  framesByIndex: ReadonlyArray<ReadonlyArray<OverlayFrameStroke>>,
  bounds: OverlayWorldBounds,
): boolean => {
  for (const frameStrokes of framesByIndex) {
    if (touchesOverlayBoundary(frameStrokes, bounds)) {
      return true;
    }
  }
  return false;
};

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

  private readonly previewResultsByKey = new SvelteMap<string, PreviewResultCacheEntry>();

  private readonly overlayFramesByKey = new SvelteMap<string, OverlayCacheEntry>();

  private readonly modulationCacheByKey = new SvelteMap<string, ModulationCacheEntry>();

  public readonly commands = {
    generateRendererPreview: (input: PreviewGenerateInput): GeneratorPreview => {
      const preview = this.resolvePreviewResultEntry(input).preview;
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
      this.currentPreviewSource = null;
      this.state.previewWindowState = null;
      this.state.surfaceModel = createEmptyPreviewSurfaceViewModel();
      this.state.modulationReadoutById = {};
      this.state.previewRevision = 0;
      this.state.sourceTimelineEndBeat = 1;
      this.state.noteCount = 0;
      this.state.uniquePitchCount = 0;
    },
  };

  private resolvePreviewResultEntry(
    input: PreviewGenerateInput & {
      preview?: GeneratorPreview | null;
    },
  ): PreviewResultCacheEntry {
    const key = this.toPreviewResultKey(
      input.sourceKey,
      input.loopLengthBeats,
      input.launchpadModel,
    );
    const cached = this.previewResultsByKey.get(key);
    if (cached) {
      return cached;
    }

    const preview = input.preview ?? this.generatePreview(
      input.sourceChain,
      input.loopLengthBeats,
      input.launchpadModel,
    );
    const sourceTimelineEndBeat = resolveSourceTimelineEnd(preview);
    const entry: PreviewResultCacheEntry = {
      key,
      preview,
      sourceTimelineEndBeat,
      ledFramesByIndex: buildLedFrameCache(preview, sourceTimelineEndBeat),
    };
    this.previewResultsByKey.set(key, entry);
    return entry;
  }

  private applyPreviewResult(input: PreviewApplyInput): void {
    const previewResult = this.resolvePreviewResultEntry(input);
    this.currentPreviewSource = {
      previewKey: previewResult.key,
      sourceKey: input.sourceKey,
      sourceChain: input.sourceChain,
      previewRevision: this.nextPreviewRevision,
    };
    this.nextPreviewRevision += 1;
    this.state.previewRevision = this.currentPreviewSource.previewRevision;
    this.state.sourceTimelineEndBeat = previewResult.sourceTimelineEndBeat;
    this.state.noteCount = previewResult.preview?.noteCount ?? 0;
    this.state.uniquePitchCount = previewResult.preview?.uniquePitchCount ?? 0;
  }

  private renderFrame(input: PreviewFrameInput): PreviewWindowState {
    const previewSource = this.currentPreviewSource;
    const sourceChain = previewSource?.sourceChain ?? input.fallbackChain;
    const sourceKey = previewSource?.sourceKey ?? input.fallbackKey;
    const previewRevision = previewSource?.previewRevision ?? 0;
    const previewResult = previewSource
      ? this.requirePreviewResult(previewSource.previewKey)
      : null;
    const sourceTimelineEndBeat = previewResult?.sourceTimelineEndBeat ?? 1;
    const beat = clamp(input.currentBeat, 0, sourceTimelineEndBeat);
    const activeVelocityByPitch = this.resolveActiveVelocityByPitchAtBeat(
      previewResult,
      beat,
    );

    const previewWindowState: PreviewWindowState = {
      activeCells: this.toActiveCells(activeVelocityByPitch, input.resolveLedRgb),
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

    const overlayCache = this.resolveOverlayCache(
      sourceKey,
      sourceChain,
      input.launchpadModel,
    );
    this.state.previewWindowState = previewWindowState;
    this.state.surfaceModel = buildPreviewSurfaceViewModel(
      previewWindowState,
      overlayCache.framesByIndex,
      overlayCache.bounds,
    );
    this.state.modulationReadoutById = this.resolveModulationReadoutById(
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
    this.state.previewWindowState = previewState;
    this.state.modulationReadoutById = {};

    if (!previewState) {
      this.state.surfaceModel = createEmptyPreviewSurfaceViewModel();
      this.state.previewRevision = 0;
      this.state.sourceTimelineEndBeat = 1;
      this.state.noteCount = 0;
      this.state.uniquePitchCount = 0;
      return;
    }

    const overlayCache = this.resolveOverlayCache(
      `preview-window:${previewState.previewRevision}`,
      previewState.chain,
      previewState.launchpadModel ?? 'mk3',
    );
    this.state.surfaceModel = buildPreviewSurfaceViewModel(
      previewState,
      overlayCache.framesByIndex,
      overlayCache.bounds,
    );
    this.state.previewRevision = previewState.previewRevision;
    this.state.sourceTimelineEndBeat = previewState.sourceTimelineEndBeat;
    this.state.noteCount = previewState.noteCount;
    this.state.uniquePitchCount = previewState.uniquePitchCount;
  }

  private requirePreviewResult(key: string): PreviewResultCacheEntry {
    const previewResult = this.previewResultsByKey.get(key);
    if (!previewResult) {
      throw new Error(`Missing preview result cache for ${key}`);
    }
    return previewResult;
  }

  private generatePreview(
    chain: GeneratorChain,
    loopLengthBeats: number,
    launchpadModel: LaunchpadModel,
  ): GeneratorPreview {
    const notes = generateNotes({
      chain,
      loopLengthBeats,
      launchpadModel,
    });
    return {
      ...generatePreviewStats(notes),
      notes,
    };
  }

  private resolveActiveVelocityByPitchAtBeat(
    previewResult: PreviewResultCacheEntry | null,
    beat: number,
  ): ReadonlyMap<number, number> {
    if (!previewResult || previewResult.ledFramesByIndex.length === 0) {
      return EMPTY_ACTIVE_VELOCITY_BY_PITCH;
    }

    const frameIndex = toPreviewFrameIndex(beat, previewResult.sourceTimelineEndBeat);
    return previewResult.ledFramesByIndex[frameIndex] ?? EMPTY_ACTIVE_VELOCITY_BY_PITCH;
  }

  private resolveOverlayCache(
    sourceKey: string,
    chain: GeneratorChain,
    launchpadModel: LaunchpadModel,
  ): OverlayCacheEntry {
    const key = `${sourceKey}:${launchpadModel}`;
    const cached = this.overlayFramesByKey.get(key);
    if (cached) {
      return cached;
    }

    let nextPadding = OVERLAY_WORLD_BASE_PADDING;
    let nextBounds = resolveOverlayWorldBounds(nextPadding);
    let nextFramesByIndex = this.buildOverlayFrames(chain, nextBounds, launchpadModel);

    while (
      touchesOverlayFrameCacheBoundary(nextFramesByIndex, nextBounds)
      && nextPadding < OVERLAY_WORLD_MAX_PADDING
    ) {
      nextPadding = Math.min(OVERLAY_WORLD_MAX_PADDING, nextPadding + OVERLAY_WORLD_PADDING_STEP);
      nextBounds = resolveOverlayWorldBounds(nextPadding);
      nextFramesByIndex = this.buildOverlayFrames(chain, nextBounds, launchpadModel);
    }

    const entry: OverlayCacheEntry = {
      key,
      bounds: nextBounds,
      framesByIndex: nextFramesByIndex,
    };
    this.overlayFramesByKey.set(key, entry);
    return entry;
  }

  private buildOverlayFrames(
    chain: GeneratorChain,
    bounds: OverlayWorldBounds,
    launchpadModel: LaunchpadModel,
  ): ReadonlyArray<ReadonlyArray<OverlayFrameStroke>> {
    return generateOverlayFrames({
      chain,
      beats01: PREVIEW_FRAME_BEATS,
      sampleStep: OVERLAY_SAMPLE_STEP,
      bounds,
      launchpadModel,
    });
  }

  private resolveModulationReadoutById(
    sourceKey: string,
    chain: GeneratorChain,
    beat: number,
    loopLengthBeats: number,
    isLoopEnabled: boolean,
  ): Readonly<Record<string, string>> {
    const modulationCache = this.resolveModulationCache(sourceKey, chain);
    if (modulationCache.modulatorIds.length === 0) {
      return EMPTY_MODULATION_READOUT_BY_ID;
    }

    const modulationBeat01 = isLoopEnabled
      ? toWrappedLoopBeat01(beat)
      : clamp(beat, 0, 1);
    const readoutById = {
      ...modulationCache.baselineById,
    };

    const readouts = evaluateModulationProgramReadouts(
      modulationCache.program,
      modulationBeat01,
      loopLengthBeats,
      { wrap: isLoopEnabled },
    );
    for (const readout of readouts) {
      readoutById[readout.modulatorId] = [
        `${readout.targetParamKey}`,
        `Current ${readout.modulatedValue.toFixed(3)}`,
        `Base ${readout.baseValue.toFixed(3)}`,
      ].join(' | ');
    }

    return readoutById;
  }

  private resolveModulationCache(
    sourceKey: string,
    chain: GeneratorChain,
  ): ModulationCacheEntry {
    const cached = this.modulationCacheByKey.get(sourceKey);
    if (cached) {
      return cached;
    }

    const modulatorIds = chain.devices
      .filter((device) => device.kind === 'modulator')
      .map((device) => device.id);
    const baselineById: Record<string, string> = {};
    for (const modulatorId of modulatorIds) {
      baselineById[modulatorId] = 'No valid target';
    }

    const entry: ModulationCacheEntry = {
      key: sourceKey,
      program: compileModulationProgram(chain),
      baselineById,
      modulatorIds,
    };
    this.modulationCacheByKey.set(sourceKey, entry);
    return entry;
  }

  private toPreviewResultKey(
    sourceKey: string,
    loopLengthBeats: number,
    launchpadModel: LaunchpadModel,
  ): string {
    return `${sourceKey}:${loopLengthBeats}:${launchpadModel}`;
  }

  private toActiveCells(
    activeVelocityByPitch: ReadonlyMap<number, number>,
    resolveLedRgb: (velocity: number) => string,
  ): PreviewWindowState['activeCells'] {
    const activeCells: PreviewWindowState['activeCells'] = [];
    for (const [pitch, velocity] of activeVelocityByPitch.entries()) {
      activeCells.push({
        pitch,
        rgb: resolveLedRgb(velocity),
      });
    }
    return activeCells;
  }
}

export const createPreviewSession = (): PreviewSession => new PreviewSession();
