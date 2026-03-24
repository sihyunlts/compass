import { SvelteMap } from 'svelte/reactivity';

import {
  compilePipelineEngine,
  evaluateExactOutputFramesAtTimes,
} from '../../../core/pipeline/engine';
import {
  generatePreviewNotesData,
  generatePreviewStats,
  getLaunchpadRuntimeMap,
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
} from '../../../domain';
import type { GeneratorChain, LaunchpadModel } from '../../../shared/model';
import type { GeneratorPreview } from '../../../shared/contracts/preview/generator-preview';
import {
  PREVIEW_FRAME_COUNT,
  toPreviewFrameBeat,
  toPreviewFrameIndex,
} from './frame-index';
import { EMPTY_ACTIVE_VELOCITY_BY_PITCH } from './utils';
import { LatestSourceKeyFamilyCache } from './source-key-cache';

const DEFAULT_EXACT_OUTPUT_WORLD_BOUNDS = {
  minX: -4,
  maxX: 13,
  minY: -4,
  maxY: 13,
} as const;

export interface PreviewResultCacheEntry {
  key: string;
  preview: GeneratorPreview | null;
  sourceTimelineEndBeat: number;
  ledFramesByIndex: ReadonlyArray<ReadonlyMap<number, number>>;
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

  private readonly latestSourceKeyByFamily = new LatestSourceKeyFamilyCache();

  public resolve(input: PreviewResultInput): PreviewResultCacheEntry {
    this.evictStaleSourceFamilyEntries(input.sourceKey);
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
    const exactFrames = this.buildExactOutputFrames(
      input.sourceChain,
      input.launchpadModel,
    );
    const entry: PreviewResultCacheEntry = {
      key,
      preview,
      sourceTimelineEndBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
      ledFramesByIndex: exactFrames.map((frame) => new Map(
        Array.from(frame.activationFrame.activeByPitch.entries(), ([pitch, info]) => [pitch, info.velocity]),
      )),
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

  public reset(): void {
    this.resultsByKey.clear();
    this.latestSourceKeyByFamily.reset();
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

  private buildExactOutputFrames(
    chain: GeneratorChain,
    launchpadModel: LaunchpadModel,
  ) {
    const runtimeMap = getLaunchpadRuntimeMap(launchpadModel);
    const engine = compilePipelineEngine(chain, {
      buttons: runtimeMap.buttons,
      buttonIndex: runtimeMap.buttonIndex,
    });

    return evaluateExactOutputFramesAtTimes(
      engine,
      Array.from(
        { length: PREVIEW_FRAME_COUNT },
        (_, index) => toPreviewFrameBeat(index, NORMALIZED_SOURCE_TIMELINE_END_BEAT),
      ),
      DEFAULT_EXACT_OUTPUT_WORLD_BOUNDS,
    );
  }

  private toPreviewResultKey(
    sourceKey: string,
    loopLengthBeats: number,
    launchpadModel: LaunchpadModel,
  ): string {
    return `${sourceKey}:${loopLengthBeats}:${launchpadModel}`;
  }

  private evictStaleSourceFamilyEntries(sourceKey: string): void {
    this.latestSourceKeyByFamily.evictStaleEntries(sourceKey, (staleSourceKey) => {
      const stalePrefix = `${staleSourceKey}:`;
      for (const key of this.resultsByKey.keys()) {
        if (key.startsWith(stalePrefix)) {
          this.resultsByKey.delete(key);
        }
      }
    });
  }
}

export const createPreviewResultCache = (): PreviewResultCache =>
  new PreviewResultCache();
