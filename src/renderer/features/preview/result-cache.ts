import { SvelteMap } from 'svelte/reactivity';
import { clamp } from '../../../shared/math';

import {
  buildGeneratedFieldResult,
  type GeneratedRuntimeFieldResult,
} from '../../../domain/field-result';
import { toGeneratorPreview } from '../../../domain/generator-preview';
import type { GeneratorChain, LaunchpadModel } from '../../../shared/model';
import type { GeneratorPreview } from '../../../shared/contracts/preview/generator-preview';
import { EMPTY_ACTIVE_VELOCITY_BY_PITCH } from './utils';
import { LatestSourceKeyFamilyCache } from './source-key-cache';

export interface PreviewResultCacheEntry {
  key: string;
  preview: GeneratorPreview;
  sourceTimelineEndBeat: number;
  sampleStepBeats: number;
  ledFramesBySampleIndex: ReadonlyArray<ReadonlyMap<number, number>>;
  generated?: GeneratedRuntimeFieldResult;
}

interface PreviewResultInput {
  sourceChain: GeneratorChain;
  sourceKey: string;
  loopLengthBeats: number;
  launchpadModel: LaunchpadModel;
  preview?: GeneratorPreview;
}

class PreviewResultCache {
  private readonly resultsByKey = new SvelteMap<string, PreviewResultCacheEntry>();

  private readonly latestSourceKeyByFamily = new LatestSourceKeyFamilyCache();

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

    const previousGenerated = input.preview
      ? undefined
      : this.resolvePreviousGeneratedResult(
        input.sourceKey,
        input.loopLengthBeats,
        input.launchpadModel,
      );
    const generated = input.preview
      ? undefined
      : buildGeneratedFieldResult({
        chain: input.sourceChain,
        loopLengthBeats: input.loopLengthBeats,
        launchpadModel: input.launchpadModel,
        previousResult: previousGenerated ?? null,
      });
    const preview = input.preview ?? toGeneratorPreview(generated);
    const entry: PreviewResultCacheEntry = {
      key,
      preview,
      sourceTimelineEndBeat: preview.sourceTimelineEndBeat,
      sampleStepBeats: preview.sampleStepBeats,
      ledFramesBySampleIndex: preview.ledFramesBySampleIndex.map((frame) => new Map<number, number>(frame)),
      generated,
    };
    this.resultsByKey.set(key, entry);
    this.evictStaleSourceFamilyEntries(input.sourceKey);
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
    if (!previewResult || previewResult.ledFramesBySampleIndex.length === 0) {
      return EMPTY_ACTIVE_VELOCITY_BY_PITCH;
    }

    const frameIndex = clamp(
      Math.floor(beat / previewResult.sampleStepBeats),
      0,
      previewResult.ledFramesBySampleIndex.length - 1,
    );
    return previewResult.ledFramesBySampleIndex[frameIndex] ?? EMPTY_ACTIVE_VELOCITY_BY_PITCH;
  }

  private toPreviewResultKey(
    sourceKey: string,
    loopLengthBeats: number,
    launchpadModel: LaunchpadModel,
  ): string {
    return `${sourceKey}:${loopLengthBeats}:${launchpadModel}`;
  }

  private evictStaleSourceFamilyEntries(sourceKey: string): void {
    const staleSourceKey = this.latestSourceKeyByFamily.replaceLatestSourceKey(sourceKey);
    if (!staleSourceKey) {
      return;
    }

    const stalePrefix = `${staleSourceKey}:`;
    for (const key of this.resultsByKey.keys()) {
      if (key.startsWith(stalePrefix)) {
        this.resultsByKey.delete(key);
      }
    }
  }

  private resolvePreviousGeneratedResult(
    sourceKey: string,
    loopLengthBeats: number,
    launchpadModel: LaunchpadModel,
  ): GeneratedRuntimeFieldResult | null {
    const previousSourceKey = this.latestSourceKeyByFamily.getLatestSourceKey(sourceKey);
    if (!previousSourceKey || previousSourceKey === sourceKey) {
      return null;
    }

    const previousKey = this.toPreviewResultKey(
      previousSourceKey,
      loopLengthBeats,
      launchpadModel,
    );
    const previousEntry = this.resultsByKey.get(previousKey);
    if (previousEntry?.generated) {
      return previousEntry.generated;
    }

    const stalePrefix = `${previousSourceKey}:`;
    for (const [key, entry] of this.resultsByKey.entries()) {
      if (key.startsWith(stalePrefix) && entry.generated) {
        return entry.generated;
      }
    }

    return null;
  }
}

export const createPreviewResultCache = (): PreviewResultCache =>
  new PreviewResultCache();
