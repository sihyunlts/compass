import { SvelteMap } from 'svelte/reactivity';

import {
  generatePreviewNotesData,
  generatePreviewStats,
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  type ColorGuideWarp,
} from '../../../domain';
import type { GeneratorChain, LaunchpadModel } from '../../../shared/model';
import type { GeneratorPreview } from '../../../shared/contracts/preview/generator-preview';
import {
  PREVIEW_FRAME_COUNT,
  toPreviewFrameBeat,
  toPreviewFrameIndex,
} from './frame-index';
import {
  collectActiveVelocityByPitch,
  EMPTY_ACTIVE_VELOCITY_BY_PITCH,
} from './utils';

export interface PreviewResultCacheEntry {
  key: string;
  preview: GeneratorPreview | null;
  sourceTimelineEndBeat: number;
  ledFramesByIndex: ReadonlyArray<ReadonlyMap<number, number>>;
  colorGuideWarpByOriginId: ReadonlyMap<string, ColorGuideWarp>;
}

interface PreviewResultInput {
  sourceChain: GeneratorChain;
  sourceKey: string;
  loopLengthBeats: number;
  launchpadModel: LaunchpadModel;
  preview?: GeneratorPreview | null;
}

class PreviewResultCache {
  private readonly resultsByKey = new SvelteMap<string, PreviewResultCacheEntry>();

  public resolve(input: PreviewResultInput): PreviewResultCacheEntry {
    const key = this.toPreviewResultKey(
      input.sourceKey,
      input.loopLengthBeats,
      input.launchpadModel,
    );
    const cached = this.resultsByKey.get(key);
    if (cached) {
      return cached;
    }

    const generatedNotes = input.preview
      ? null
      : generatePreviewNotesData({
        chain: input.sourceChain,
        loopLengthBeats: input.loopLengthBeats,
        launchpadModel: input.launchpadModel,
      });
    const preview = input.preview ?? {
      ...generatePreviewStats(generatedNotes?.notes ?? []),
      notes: generatedNotes?.notes ?? [],
    };
    const colorGuideWarpByOriginId = generatedNotes?.colorGuideWarpByOriginId
      ?? this.generateColorGuideWarp(
        input.sourceChain,
        input.loopLengthBeats,
        input.launchpadModel,
      );
    const entry: PreviewResultCacheEntry = {
      key,
      preview,
      sourceTimelineEndBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
      ledFramesByIndex: this.buildLedFrameCache(
        preview,
        NORMALIZED_SOURCE_TIMELINE_END_BEAT,
      ),
      colorGuideWarpByOriginId,
    };
    this.resultsByKey.set(key, entry);
    return entry;
  }

  public require(key: string): PreviewResultCacheEntry {
    const previewResult = this.resultsByKey.get(key);
    if (!previewResult) {
      throw new Error(`Missing preview result cache for ${key}`);
    }
    return previewResult;
  }

  public resolveActiveVelocityByPitchAtBeat(
    previewResult: PreviewResultCacheEntry | null,
    beat: number,
  ): ReadonlyMap<number, number> {
    if (!previewResult || previewResult.ledFramesByIndex.length === 0) {
      return EMPTY_ACTIVE_VELOCITY_BY_PITCH;
    }

    const frameIndex = toPreviewFrameIndex(beat, previewResult.sourceTimelineEndBeat);
    return previewResult.ledFramesByIndex[frameIndex] ?? EMPTY_ACTIVE_VELOCITY_BY_PITCH;
  }

  private generateColorGuideWarp(
    chain: GeneratorChain,
    loopLengthBeats: number,
    launchpadModel: LaunchpadModel,
  ): ReadonlyMap<string, ColorGuideWarp> {
    return generatePreviewNotesData({
      chain,
      loopLengthBeats,
      launchpadModel,
    }).colorGuideWarpByOriginId;
  }

  private buildLedFrameCache(
    preview: GeneratorPreview | null,
    timelineSpanBeats: number,
  ): ReadonlyArray<ReadonlyMap<number, number>> {
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
  }

  private toPreviewResultKey(
    sourceKey: string,
    loopLengthBeats: number,
    launchpadModel: LaunchpadModel,
  ): string {
    return `${sourceKey}:${loopLengthBeats}:${launchpadModel}`;
  }
}

export const createPreviewResultCache = (): PreviewResultCache =>
  new PreviewResultCache();
