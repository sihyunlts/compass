import { MIN_NOTE_DURATION, SAMPLES_PER_BEAT } from '../core/pipeline/constants';
import { collectPitchSampledNotes } from '../core/pipeline/note-sampling';
import {
  compilePipelineEngine,
  evaluateExactOutputFrameAtTime,
  type CompiledPipelineEngine,
} from '../core/pipeline/engine';
import {
  isGeneratorNode as isPipelineGeneratorNode,
  resolveMutedSources,
} from '../core/pipeline/groups';
import { fitNotesToTimeline } from '../core/pipeline/timeline-fit';
import {
  applyColorDeviceToNotes,
  type ClipNoteWithOrigin,
} from '../devices/color/engine';
import { isDeviceEffectivelyEnabled } from '../shared/group-state';
import { normalizeOptionalId } from '../shared/normalize-id';
import type {
  GeneratorChain,
  GeneratorDeviceNode,
} from '../shared/model';
import {
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  type NoteGenerationState,
  type RuntimeMapData,
} from './note-generation-types';
import { filterNotesByMask, resolveActiveTileIdsAtBeat } from './mask-note-filter';
import {
  cloneNotes,
  filterNotesByOriginIds,
  groupNotesByOriginId,
  sortClipNotes,
} from './note-utils';

const buildEngine = (
  chain: GeneratorChain,
  runtimeMap: RuntimeMapData,
): CompiledPipelineEngine => compilePipelineEngine(chain, {
  buttons: runtimeMap.buttons,
  buttonIndex: runtimeMap.buttonIndex,
});

const collectRawNotesForChain = (
  chain: GeneratorChain,
  loopLengthBeats: number,
  runtimeMap: RuntimeMapData,
): ClipNoteWithOrigin[] => {
  if (!Number.isFinite(loopLengthBeats) || loopLengthBeats <= 0) {
    return [];
  }

  const steps = Math.round(loopLengthBeats * SAMPLES_PER_BEAT);
  if (!Number.isFinite(steps) || steps <= 0) {
    return [];
  }

  const engine = buildEngine(chain, runtimeMap);
  const notes: ClipNoteWithOrigin[] = collectPitchSampledNotes({
    sampleCount: steps,
    endBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
    minimumNoteDuration: MIN_NOTE_DURATION,
    resolveActiveByPitch: (sampleBeat) =>
      evaluateExactOutputFrameAtTime(engine, sampleBeat).activationFrame.activeByPitch,
  });

  sortClipNotes(notes);
  return notes;
};

const applyColorToCurrentNotes = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  device: Extract<GeneratorDeviceNode, { kind: 'color' }>,
): ClipNoteWithOrigin[] => {
  if (notes.length === 0) {
    return [];
  }

  const passthrough = notes
    .filter((note) => !note.originId)
    .map((note) => ({ ...note }));
  const notesByOriginId = new Map<string, ClipNoteWithOrigin[]>();

  for (const note of notes) {
    if (!note.originId) {
      continue;
    }

    const originNotes = notesByOriginId.get(note.originId);
    if (originNotes) {
      originNotes.push(note);
    } else {
      notesByOriginId.set(note.originId, [{ ...note }]);
    }
  }

  for (const [originId, originNotes] of notesByOriginId.entries()) {
    const colorProgram = applyColorDeviceToNotes(
      originNotes,
      device,
      MIN_NOTE_DURATION,
    );
    if (!colorProgram) {
      continue;
    }

    notesByOriginId.set(originId, colorProgram.notes);
  }

  const colorized = [...passthrough];
  for (const originNotes of notesByOriginId.values()) {
    colorized.push(...cloneNotes(originNotes));
  }
  sortClipNotes(colorized);
  return colorized;
};

const isGeneratorNode = (
  device: GeneratorDeviceNode,
): boolean => (
  isPipelineGeneratorNode(device)
);

const buildGeometryOnlyCheckpointChain = (
  chain: GeneratorChain,
  endExclusive: number,
): GeneratorChain => ({
  devices: chain.devices
    .slice(0, endExclusive)
    .filter((device) => device.kind !== 'color')
    .filter((device) => device.kind !== 'mask' || device.params.sourceKind === 'tiles'),
  groupStateById: chain.groupStateById,
});

export const buildOriginGroupIdByGeneratorId = (
  chain: GeneratorChain,
): Map<string, string | null> => {
  const byGeneratorId = new Map<string, string | null>();

  for (const device of chain.devices) {
    if (isGeneratorNode(device)) {
      byGeneratorId.set(device.id, normalizeOptionalId(device.groupId));
    }
  }

  return byGeneratorId;
};

const resolveScopedOriginIds = (
  originGroupIdByGeneratorId: ReadonlyMap<string, string | null>,
  upstreamOriginIds: ReadonlyArray<string>,
  effectGroupId: string | null | undefined,
): string[] => {
  const targetGroupId = normalizeOptionalId(effectGroupId);
  if (!targetGroupId) {
    return [...upstreamOriginIds];
  }

  return upstreamOriginIds.filter((originId) =>
    originGroupIdByGeneratorId.get(originId) === targetGroupId);
};

const resolveSourceOriginIds = (
  state: NoteGenerationState,
  sourceKind: 'group' | 'generator',
  sourceId: string,
): Set<string> => {
  if (sourceKind === 'generator') {
    return new Set([sourceId]);
  }

  const originIds = new Set<string>();
  for (const [originId, groupId] of state.originGroupIdByGeneratorId.entries()) {
    if (groupId === sourceId) {
      originIds.add(originId);
    }
  }

  return originIds;
};

const buildFittedCheckpointCacheKey = (
  endExclusive: number,
  sourceKind: 'group' | 'generator',
  sourceId: string,
): string => `${endExclusive}:${sourceKind}:${sourceId}`;

const fitCheckpointNotes = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  state: NoteGenerationState,
  cacheKey: string,
): ClipNoteWithOrigin[] => {
  const cached = state.fittedSourceNotesByKey.get(cacheKey);
  if (cached) {
    return cloneNotes(cached);
  }

  const fitted = fitNotesToTimeline(notes).fittedNotes;
  state.fittedSourceNotesByKey.set(cacheKey, fitted);
  return cloneNotes(fitted);
};

export const evaluateCheckpointNotes = (
  state: NoteGenerationState,
  endExclusive: number,
): ClipNoteWithOrigin[] => {
  const cached = state.checkpointNotesByIndex.get(endExclusive);
  if (cached) {
    return cloneNotes(cached);
  }

  const geometryOnlyChain = buildGeometryOnlyCheckpointChain(state.chain, endExclusive);
  const rawNotes = collectRawNotesForChain(
    geometryOnlyChain,
    state.loopLengthBeats,
    state.runtimeMap,
  );
  const notesByOriginId = groupNotesByOriginId(rawNotes);
  const upstreamOriginIds: string[] = [];
  const prefixDevices = state.chain.devices.slice(0, endExclusive);

  for (let index = 0; index < prefixDevices.length; index += 1) {
    const device = prefixDevices[index];
    if (!isDeviceEffectivelyEnabled(state.chain, device)) {
      continue;
    }

    if (isGeneratorNode(device)) {
      upstreamOriginIds.push(device.id);
      if (!notesByOriginId.has(device.id)) {
        notesByOriginId.set(device.id, []);
      }
      continue;
    }

    const targetOriginIds = resolveScopedOriginIds(
      state.originGroupIdByGeneratorId,
      upstreamOriginIds,
      device.groupId,
    );
    if (targetOriginIds.length === 0) {
      continue;
    }

    if (device.kind === 'color') {
      for (const originId of targetOriginIds) {
        notesByOriginId.set(
          originId,
          applyColorToCurrentNotes(notesByOriginId.get(originId) ?? [], device),
        );
      }
      continue;
    }

    if (device.kind !== 'mask' || device.params.sourceKind === 'tiles') {
      continue;
    }

    const sourceId = normalizeOptionalId(device.params.sourceId);
    if (!sourceId) {
      for (const originId of targetOriginIds) {
        notesByOriginId.set(originId, []);
      }
      continue;
    }

    const sourceNotes = fitCheckpointNotes(
      filterNotesByOriginIds(
        evaluateCheckpointNotes(state, index),
        resolveSourceOriginIds(state, device.params.sourceKind, sourceId),
      ),
      state,
      buildFittedCheckpointCacheKey(index, device.params.sourceKind, sourceId),
    );

    for (const originId of targetOriginIds) {
      notesByOriginId.set(
        originId,
        filterNotesByMask(
          notesByOriginId.get(originId) ?? [],
          device,
          state.runtimeMap,
          (beat) => resolveActiveTileIdsAtBeat(sourceNotes, beat, state.runtimeMap),
        ),
      );
    }
  }

  const notes: ClipNoteWithOrigin[] = [];
  for (const originId of upstreamOriginIds) {
    notes.push(...cloneNotes(notesByOriginId.get(originId) ?? []));
  }
  sortClipNotes(notes);
  state.checkpointNotesByIndex.set(endExclusive, notes);
  return cloneNotes(notes);
};

export const buildFinalOutputNotes = (
  state: NoteGenerationState,
): ClipNoteWithOrigin[] => {
  const { mutedGroupIds, mutedGeneratorIds } = resolveMutedSources(state.chain);
  const notes = evaluateCheckpointNotes(state, state.chain.devices.length)
    .filter((note) => {
      if (!note.originId) {
        return true;
      }

      if (mutedGeneratorIds.has(note.originId)) {
        return false;
      }

      const groupId = state.originGroupIdByGeneratorId.get(note.originId);
      return !groupId || !mutedGroupIds.has(groupId);
    });
  sortClipNotes(notes);
  return notes;
};
