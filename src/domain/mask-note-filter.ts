import { MIN_NOTE_DURATION, SAMPLES_PER_BEAT } from '../core/pipeline/constants';
import { closeSampledNote } from '../core/pipeline/note-sampling';
import type { MaskEffectNode } from '../shared/model';
import type { ClipNoteWithOrigin } from '../devices/color/engine';
import { NORMALIZED_SOURCE_TIMELINE_END_BEAT, type RuntimeMapData } from './note-generation-types';
import { sortClipNotes } from './note-utils';
import { resolveAddressKey } from './runtime-map';

export const resolveActiveTileIdsAtBeat = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  beat: number,
  runtimeMap: RuntimeMapData,
): Set<number> => {
  const activeTiles = new Set<number>();

  for (const note of notes) {
    if (!(note.startBeat <= beat && beat < note.startBeat + note.durationBeats)) {
      continue;
    }

    const tileId = runtimeMap.buttonAddressToTileId.get(
      resolveAddressKey(note.pitch, note.channel),
    );
    if (tileId !== undefined) {
      activeTiles.add(tileId);
    }
  }

  return activeTiles;
};

export const filterNotesByMask = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  effect: MaskEffectNode,
  runtimeMap: RuntimeMapData,
  resolveMaskTilesAtBeat: (beat: number) => ReadonlySet<number>,
): ClipNoteWithOrigin[] => {
  if (notes.length === 0) {
    return [];
  }

  const openByAddress = new Map<string, {
    pitch: number;
    startBeat: number;
    velocity: number;
    channel: number;
    originId?: string;
  }>();
  const filtered: ClipNoteWithOrigin[] = [];

  for (let step = 0; step < SAMPLES_PER_BEAT; step += 1) {
    const beat = step / SAMPLES_PER_BEAT;
    const maskTiles = resolveMaskTilesAtBeat(beat);
    const activeByAddress = new Map<string, ClipNoteWithOrigin>();

    for (const note of notes) {
      if (!(note.startBeat <= beat && beat < note.startBeat + note.durationBeats)) {
        continue;
      }

      const addressKey = resolveAddressKey(note.pitch, note.channel);
      const tileId = runtimeMap.buttonAddressToTileId.get(addressKey);
      if (tileId === undefined) {
        continue;
      }

      const isIncluded = maskTiles.has(tileId);
      const shouldKeep = effect.params.mode === 'include' ? isIncluded : !isIncluded;
      if (!shouldKeep) {
        continue;
      }

      const existing = activeByAddress.get(addressKey);
      if (!existing || note.velocity > existing.velocity) {
        activeByAddress.set(addressKey, note);
      }
    }

    for (const [addressKey, open] of openByAddress.entries()) {
      if (activeByAddress.has(addressKey)) {
        continue;
      }
      closeSampledNote(filtered, open.pitch, open, beat, MIN_NOTE_DURATION);
      openByAddress.delete(addressKey);
    }

    for (const [addressKey, note] of activeByAddress.entries()) {
      const existing = openByAddress.get(addressKey);
      if (
        existing
        && existing.velocity === note.velocity
        && existing.channel === note.channel
        && existing.originId === note.originId
      ) {
        continue;
      }

      if (existing) {
        closeSampledNote(filtered, existing.pitch, existing, beat, MIN_NOTE_DURATION);
      }

      openByAddress.set(addressKey, {
        pitch: note.pitch,
        startBeat: beat,
        velocity: note.velocity,
        channel: note.channel,
        originId: note.originId,
      });
    }
  }

  for (const open of openByAddress.values()) {
    closeSampledNote(
      filtered,
      open.pitch,
      open,
      NORMALIZED_SOURCE_TIMELINE_END_BEAT,
      MIN_NOTE_DURATION,
    );
  }

  sortClipNotes(filtered);
  return filtered;
};
