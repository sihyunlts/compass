import { SvelteMap } from 'svelte/reactivity';

import {
  generatePreviewNotesData,
  generatePreviewStats,
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
} from '../../../domain';
import type { ClipNote, GeneratorChain, LaunchpadModel } from '../../../shared/model';
import type { GeneratorPreview } from '../../../shared/contracts/preview/generator-preview';
import {
  PREVIEW_FRAME_COUNT,
  toPreviewFrameBeat,
  toPreviewFrameIndex,
} from './frame-index';
import { EMPTY_ACTIVE_VELOCITY_BY_PITCH } from './utils';
import { LatestSourceKeyFamilyCache } from './source-key-cache';

export interface PreviewResultCacheEntry {
  key: string;
  preview: GeneratorPreview;
  sourceTimelineEndBeat: number;
  ledFramesByIndex: ReadonlyArray<ReadonlyMap<number, number>>;
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
  sourceTimelineEndBeat: number,
): boolean => {
  if (!Number.isFinite(note.startBeat) || !Number.isFinite(note.durationBeats)) {
    return false;
  }

  const noteStart = note.startBeat;
  const noteEnd = note.startBeat + Math.max(note.durationBeats, 0);
  if (beat >= sourceTimelineEndBeat) {
    return noteStart <= beat && noteEnd >= beat;
  }

  return noteStart <= beat && beat < noteEnd;
};

const buildLedFrameAtBeat = (
  notes: ReadonlyArray<ClipNote>,
  beat: number,
  sourceTimelineEndBeat: number,
): ReadonlyMap<number, number> => {
  const activeVelocityByPitch = new Map<number, number>();

  for (const note of notes) {
    if (!isNoteActiveAtBeat(note, beat, sourceTimelineEndBeat)) {
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
): ReadonlyArray<ReadonlyMap<number, number>> => Array.from(
  { length: PREVIEW_FRAME_COUNT },
  (_, index) => buildLedFrameAtBeat(
    notes,
    toPreviewFrameBeat(index, sourceTimelineEndBeat),
    sourceTimelineEndBeat,
  ),
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

    const generatedNotes = input.preview
      ? null
      : generatePreviewNotesData({
        chain: input.sourceChain,
        loopLengthBeats: input.loopLengthBeats,
        launchpadModel: input.launchpadModel,
      });
    const preview = input.preview ?? (() => {
      const generatedPreview = generatedNotes ?? {
        notes: [],
        sourceTimelineEndBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
      };
      return {
        ...generatePreviewStats(generatedPreview.notes),
        notes: generatedPreview.notes,
        sourceTimelineEndBeat: generatedPreview.sourceTimelineEndBeat,
      };
    })();
    const entry: PreviewResultCacheEntry = {
      key,
      preview,
      sourceTimelineEndBeat: preview.sourceTimelineEndBeat,
      ledFramesByIndex: buildLedFramesFromNotes(
        preview.notes,
        preview.sourceTimelineEndBeat,
      ),
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
