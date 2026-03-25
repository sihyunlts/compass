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
import type { GeneratorChain } from '../shared/model';
import {
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  type NoteGenerationState,
  type RuntimeMapData,
} from './note-generation-types';
import { filterNotesByMask, resolveActiveTileIdsAtBeat } from './mask-note-filter';
import {
  applyNoteStageTimeWarpToNotes,
} from './note-stage-effects';
import {
  cloneNotes,
  filterNotesByOriginIds,
  groupNotesByOriginId,
  sortClipNotes,
} from './note-utils';

interface DeferredColorOperation {
  device: Extract<GeneratorChain['devices'][number], { kind: 'color' }>;
}

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
    .filter((device) => device.kind !== 'mask' || device.params.sourceKind === 'tiles'),
  groupStateById: checkpointChain.groupStateById,
});

const applyDeferredColors = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  deferredColors: ReadonlyArray<DeferredColorOperation>,
): ClipNoteWithOrigin[] => {
  let current = cloneNotes(notes);

  for (const operation of deferredColors) {
    const colorProgram = applyColorDeviceToNotes(
      current,
      operation.device,
      MIN_NOTE_DURATION,
    );
    if (colorProgram) {
      current = colorProgram.notes;
    }
  }

  return current;
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

const resolveNoteStageBoundaryIndexByOriginId = (
  checkpointChain: GeneratorChain,
): Map<string, number> => {
  const pendingColorOriginIds = new Set<string>();
  const boundaryIndexByOriginId = new Map<string, number>();

  walkEnabledChainOriginScopes(checkpointChain, {
    onScopedDevice(device, deviceIndex, targetOriginIds) {
      if (targetOriginIds.length === 0) {
        return;
      }

      if (device.kind === 'color') {
        for (const originId of targetOriginIds) {
          pendingColorOriginIds.add(originId);
        }
        return;
      }

      if (device.kind !== 'timewarp') {
        return;
      }

      for (const originId of targetOriginIds) {
        if (pendingColorOriginIds.has(originId) && !boundaryIndexByOriginId.has(originId)) {
          boundaryIndexByOriginId.set(originId, deviceIndex);
        }
      }
    },
  });

  return boundaryIndexByOriginId;
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
  const noteStageBoundaryIndexByOriginId = resolveNoteStageBoundaryIndexByOriginId(
    checkpointChain,
  );
  const orderedOriginIds: string[] = [];
  const noteStageNotesByOriginId = new Map<string, ClipNoteWithOrigin[]>();
  const sceneCheckpointNotesByIndex = new Map<number, Map<string, ClipNoteWithOrigin[]>>();

  const resolveSceneCheckpointNotesByOriginId = (
    sceneEndExclusive: number,
  ): Map<string, ClipNoteWithOrigin[]> => {
    const cachedSceneNotes = sceneCheckpointNotesByIndex.get(sceneEndExclusive);
    if (cachedSceneNotes) {
      return cachedSceneNotes;
    }

    const sceneCheckpointChain = buildCheckpointChain(state.chain, sceneEndExclusive);
    const sceneNotesByOriginId = groupNotesByOriginId(
      collectRawNotesForChain(
        buildGeometryOnlyCheckpointChain(sceneCheckpointChain),
        state.loopLengthBeats,
        state.runtimeMap,
      ),
    );
    const deferredSceneColorsByOriginId = new Map<string, DeferredColorOperation[]>();

    const materializeDeferredSceneColorsForOrigin = (
      originId: string,
    ): ClipNoteWithOrigin[] => {
      const deferred = deferredSceneColorsByOriginId.get(originId);
      if (!deferred || deferred.length === 0) {
        return sceneNotesByOriginId.get(originId) ?? [];
      }

      const materialized = applyDeferredColors(
        sceneNotesByOriginId.get(originId) ?? [],
        deferred,
      );
      sceneNotesByOriginId.set(originId, materialized);
      deferredSceneColorsByOriginId.set(originId, []);
      return materialized;
    };

    walkEnabledChainOriginScopes(sceneCheckpointChain, {
      onGenerator(generator) {
        if (!sceneNotesByOriginId.has(generator.id)) {
          sceneNotesByOriginId.set(generator.id, []);
        }
      },
      onScopedDevice(device, deviceIndex, targetOriginIds) {
        if (targetOriginIds.length === 0) {
          return;
        }

        if (device.kind === 'color') {
          for (const originId of targetOriginIds) {
            const deferred = deferredSceneColorsByOriginId.get(originId) ?? [];
            deferred.push({ device });
            deferredSceneColorsByOriginId.set(originId, deferred);
          }
          return;
        }

        if (device.kind !== 'mask') {
          return;
        }

        if (device.params.sourceKind === 'tiles') {
          return;
        }

        const sourceId = normalizeOptionalId(device.params.sourceId);
        if (!sourceId) {
          for (const originId of targetOriginIds) {
            materializeDeferredSceneColorsForOrigin(originId);
            sceneNotesByOriginId.set(originId, []);
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
          sceneNotesByOriginId.set(
            originId,
            filterNotesByMask(
              materializeDeferredSceneColorsForOrigin(originId),
              device,
              state.runtimeMap,
              (beat) => resolveActiveTileIdsAtBeat(sourceNotes, beat, state.runtimeMap),
            ),
          );
        }
      },
    });

    for (const [originId, deferred] of deferredSceneColorsByOriginId.entries()) {
      if (deferred.length === 0) {
        continue;
      }

      sceneNotesByOriginId.set(
        originId,
        applyDeferredColors(sceneNotesByOriginId.get(originId) ?? [], deferred),
      );
    }

    sceneCheckpointNotesByIndex.set(sceneEndExclusive, sceneNotesByOriginId);
    return sceneNotesByOriginId;
  };

  const resolveBaseNotesForOrigin = (originId: string): ClipNoteWithOrigin[] => {
    const sceneEndExclusive = noteStageBoundaryIndexByOriginId.get(originId) ?? endExclusive;
    return cloneNotes(
      resolveSceneCheckpointNotesByOriginId(sceneEndExclusive).get(originId) ?? [],
    );
  };

  const materializeNoteStageNotesForOrigin = (originId: string): ClipNoteWithOrigin[] => {
    const existing = noteStageNotesByOriginId.get(originId);
    if (existing) {
      return existing;
    }

    const materialized = resolveBaseNotesForOrigin(originId);
    noteStageNotesByOriginId.set(originId, materialized);
    return materialized;
  };

  walkEnabledChainOriginScopes(checkpointChain, {
    onGenerator(generator) {
      orderedOriginIds.push(generator.id);
    },
    onScopedDevice(device, deviceIndex, targetOriginIds) {
      if (targetOriginIds.length === 0) {
        return;
      }

      if (device.kind === 'color') {
        for (const originId of targetOriginIds) {
          const existingNoteStageNotes = noteStageNotesByOriginId.get(originId);
          if (existingNoteStageNotes) {
            const colorProgram = applyColorDeviceToNotes(
              existingNoteStageNotes,
              device,
              MIN_NOTE_DURATION,
            );
            if (colorProgram) {
              noteStageNotesByOriginId.set(originId, colorProgram.notes);
            }
          }
        }
        return;
      }

      if (device.kind === 'timewarp') {
        for (const originId of targetOriginIds) {
          const boundaryIndex = noteStageBoundaryIndexByOriginId.get(originId);
          if (boundaryIndex === undefined || deviceIndex < boundaryIndex) {
            continue;
          }

          noteStageNotesByOriginId.set(
            originId,
            applyNoteStageTimeWarpToNotes(
              materializeNoteStageNotesForOrigin(originId),
              device.params.curve,
            ),
          );
        }
        return;
      }
    },
  });

  const notes: ClipNoteWithOrigin[] = [];
  for (const originId of orderedOriginIds) {
    notes.push(...cloneNotes(
      noteStageNotesByOriginId.get(originId)
      ?? resolveBaseNotesForOrigin(originId),
    ));
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
