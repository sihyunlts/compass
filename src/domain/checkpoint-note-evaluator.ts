import { MIN_NOTE_DURATION, SAMPLES_PER_BEAT } from '../core/pipeline/constants';
import { collectPitchSampledNotes } from '../core/pipeline/note-sampling';
import {
  analyzeChainOriginTimelinePolicy,
  type OriginTimelinePolicy,
  walkEnabledChainOriginScopes,
} from '../core/pipeline/origin-timeline-policy';
import {
  compilePipelineEngine,
  evaluateExactOutputFrameAtTime,
  type CompiledPipelineEngine,
} from '../core/pipeline/engine';
import { resolveMutedSources } from '../core/pipeline/groups';
import { normalizeNotesByOriginTimelinePolicy } from '../core/pipeline/timeline-fit';
import {
  applyColorDeviceToNotes,
  type ClipNoteWithOrigin,
} from '../devices/color/engine';
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

const buildCheckpointChain = (
  chain: GeneratorChain,
  endExclusive: number,
): GeneratorChain => ({
  devices: chain.devices.slice(0, endExclusive),
  groupStateById: chain.groupStateById,
});

const buildGeometryOnlyCheckpointChain = (
  checkpointChain: GeneratorChain,
): GeneratorChain => ({
  devices: checkpointChain.devices
    .filter((device) => device.kind !== 'color')
    .filter((device) => device.kind !== 'mask' || device.params.sourceKind === 'tiles'),
  groupStateById: checkpointChain.groupStateById,
});

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

const buildNormalizedCheckpointSourceCacheKey = (
  sourceCheckpointIndex: number,
  sourceKind: 'group' | 'generator',
  sourceId: string,
): string => `${sourceCheckpointIndex}:${sourceKind}:${sourceId}`;

const resolveOriginTimelinePolicyForCheckpoint = (
  state: NoteGenerationState,
  endExclusive: number,
): ReadonlyMap<string, OriginTimelinePolicy> => {
  const cached = state.originTimelinePolicyByCheckpointIndex.get(endExclusive);
  if (cached) {
    return cached;
  }

  const analyzed = analyzeChainOriginTimelinePolicy(
    buildCheckpointChain(state.chain, endExclusive),
  );
  state.originTimelinePolicyByCheckpointIndex.set(
    endExclusive,
    analyzed.originTimelinePolicyByGeneratorId,
  );
  return analyzed.originTimelinePolicyByGeneratorId;
};

const normalizeCheckpointSourceNotes = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  state: NoteGenerationState,
  sourceCheckpointIndex: number,
  cacheKey: string,
): ClipNoteWithOrigin[] => {
  const cached = state.normalizedSourceNotesByKey.get(cacheKey);
  if (cached) {
    return cloneNotes(cached);
  }

  const normalized = normalizeNotesByOriginTimelinePolicy(
    notes,
    resolveOriginTimelinePolicyForCheckpoint(state, sourceCheckpointIndex),
  ).notes;
  state.normalizedSourceNotesByKey.set(cacheKey, normalized);
  return cloneNotes(normalized);
};

export const evaluateCheckpointNotes = (
  state: NoteGenerationState,
  endExclusive: number,
): ClipNoteWithOrigin[] => {
  const cached = state.checkpointNotesByIndex.get(endExclusive);
  if (cached) {
    return cloneNotes(cached);
  }

  const checkpointChain = buildCheckpointChain(state.chain, endExclusive);
  const geometryOnlyChain = buildGeometryOnlyCheckpointChain(checkpointChain);
  const rawNotes = collectRawNotesForChain(
    geometryOnlyChain,
    state.loopLengthBeats,
    state.runtimeMap,
  );
  const notesByOriginId = groupNotesByOriginId(rawNotes);
  const orderedOriginIds: string[] = [];

  walkEnabledChainOriginScopes(checkpointChain, {
    onGenerator(generator) {
      orderedOriginIds.push(generator.id);
      if (!notesByOriginId.has(generator.id)) {
        notesByOriginId.set(generator.id, []);
      }
    },
    onScopedDevice(device, deviceIndex, targetOriginIds) {
      if (targetOriginIds.length === 0) {
        return;
      }

      if (device.kind === 'color') {
        for (const originId of targetOriginIds) {
          notesByOriginId.set(
            originId,
            applyColorToCurrentNotes(notesByOriginId.get(originId) ?? [], device),
          );
        }
        return;
      }

      if (device.kind !== 'mask' || device.params.sourceKind === 'tiles') {
        return;
      }

      const sourceId = normalizeOptionalId(device.params.sourceId);
      if (!sourceId) {
        for (const originId of targetOriginIds) {
          notesByOriginId.set(originId, []);
        }
        return;
      }

      const sourceNotes = normalizeCheckpointSourceNotes(
        filterNotesByOriginIds(
          evaluateCheckpointNotes(state, deviceIndex),
          resolveSourceOriginIds(state, device.params.sourceKind, sourceId),
        ),
        state,
        deviceIndex,
        buildNormalizedCheckpointSourceCacheKey(
          deviceIndex,
          device.params.sourceKind,
          sourceId,
        ),
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
    },
  });

  const notes: ClipNoteWithOrigin[] = [];
  for (const originId of orderedOriginIds) {
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
