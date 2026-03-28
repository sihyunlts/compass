import { SvelteMap } from 'svelte/reactivity';
import { clamp } from '../../../shared/math';

import {
  buildGeneratorPreview,
} from '../../../domain';
import type { ClipNote, GeneratorChain, LaunchpadModel } from '../../../shared/model';
import type { GeneratorPreview } from '../../../shared/contracts/preview/generator-preview';
import { EMPTY_ACTIVE_VELOCITY_BY_PITCH } from './utils';
import { LatestSourceKeyFamilyCache } from './source-key-cache';

export interface PreviewResultCacheEntry {
  key: string;
  preview: GeneratorPreview;
  sourceTimelineEndBeat: number;
  sampleStepBeats: number;
  ledFramesBySampleIndex: ReadonlyArray<ReadonlyMap<number, number>>;
}

interface PreviewResultInput {
  sourceChain: GeneratorChain;
  sourceKey: string;
  loopLengthBeats: number;
  launchpadModel: LaunchpadModel;
  preview?: GeneratorPreview;
}

const isNoteActiveAtBeat = (
  note: ClipNote,
  beat: number,
): boolean => {
  if (!Number.isFinite(note.startBeat) || !Number.isFinite(note.durationBeats)) {
    return false;
  }

  const noteStart = note.startBeat;
  const noteEnd = note.startBeat + Math.max(note.durationBeats, 0);
  return noteStart <= beat && beat < noteEnd;
};

const buildLedFrameAtBeat = (
  notes: ReadonlyArray<ClipNote>,
  beat: number,
): ReadonlyMap<number, number> => {
  const activeVelocityByPitch = new Map<number, number>();

  for (const note of notes) {
    if (!isNoteActiveAtBeat(note, beat)) {
      continue;
    }

    const previousVelocity = activeVelocityByPitch.get(note.pitch) ?? 0;
    if (note.velocity > previousVelocity) {
      activeVelocityByPitch.set(note.pitch, note.velocity);
    }
  }

  return activeVelocityByPitch;
};

const buildLedFramesFromNotes = (
  notes: ReadonlyArray<ClipNote>,
  sourceTimelineEndBeat: number,
  sampleStepBeats: number,
): ReadonlyArray<ReadonlyMap<number, number>> => {
  const safeSourceTimelineEndBeat = Number.isFinite(sourceTimelineEndBeat) && sourceTimelineEndBeat > 0
    ? sourceTimelineEndBeat
    : 1;
  const safeSampleStepBeats = Number.isFinite(sampleStepBeats) && sampleStepBeats > 0
    ? sampleStepBeats
    : 1 / 256;
  const sampleCount = Math.max(Math.ceil(safeSourceTimelineEndBeat / safeSampleStepBeats), 1);

  return Array.from({ length: sampleCount }, (_, sampleIndex) =>
    buildLedFrameAtBeat(notes, sampleIndex * safeSampleStepBeats));
};

const buildLedFramesFromPreview = (
  preview: GeneratorPreview,
): ReadonlyArray<ReadonlyMap<number, number>> => (
  Array.isArray(preview.ledFramesBySampleIndex) && preview.ledFramesBySampleIndex.length > 0
    ? preview.ledFramesBySampleIndex.map((frame) => new Map<number, number>(frame))
    : buildLedFramesFromNotes(
        preview.notes,
        preview.sourceTimelineEndBeat,
        preview.sampleStepBeats,
      )
);

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

    const preview = input.preview ?? buildGeneratorPreview({
      chain: input.sourceChain,
      loopLengthBeats: input.loopLengthBeats,
      launchpadModel: input.launchpadModel,
    });
    const entry: PreviewResultCacheEntry = {
      key,
      preview,
      sourceTimelineEndBeat: preview.sourceTimelineEndBeat,
      sampleStepBeats: preview.sampleStepBeats,
      ledFramesBySampleIndex: buildLedFramesFromPreview(preview),
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
