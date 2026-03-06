import { SvelteMap } from 'svelte/reactivity';

import {
  generateNotes,
  generatePreviewStats,
} from '../../../domain';
import type { GeneratorChain, LaunchpadModel } from '../../../shared/model';
import type { GeneratorPreview } from '../../../shared/contracts/preview/generator-preview';
import {
  PREVIEW_FRAME_COUNT,
  toPreviewFrameBeat,
  toPreviewFrameIndex,
} from '../../services/preview-cache';
import {
  collectActiveVelocityByPitch,
  EMPTY_ACTIVE_VELOCITY_BY_PITCH,
  resolveSourceTimelineEnd,
} from './utils';

export interface PreviewResultCacheEntry {
  key: string;
  preview: GeneratorPreview | null;
  sourceTimelineEndBeat: number;
  ledFramesByIndex: ReadonlyArray<ReadonlyMap<number, number>>;
}

export interface PreviewResultInput {
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
      ledFramesByIndex: this.buildLedFrameCache(preview, sourceTimelineEndBeat),
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
