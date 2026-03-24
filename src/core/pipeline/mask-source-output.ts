import { applyNoteStageColorPrograms } from '../../devices/color/engine';
import type { GeneratorChain } from '../../shared/model';
import type { SceneInstance } from '../core-types';
import { projectSceneToActivationFrame } from './active';
import { MIN_NOTE_DURATION, SAMPLES_PER_BEAT, TILE_COUNT } from './constants';
import { isGeneratorNode, resolveMaskTime, resolveMutedSources, splitChainByGroup } from './groups';
import { collectPitchSampledNotes } from './note-sampling';
import { fitNotesToTimeline } from './timeline-fit';
import type {
  GroupEvaluationContext,
  GroupId,
  MaskTimeKind,
  TimedOutputNote,
} from './types';

interface MaskSourceOutputDependencies {
  resolveOutputGroupSceneInstances: (
    groupId: GroupId,
    context: GroupEvaluationContext,
  ) => SceneInstance[];
}

const buildGroupById = (
  groupChains: ReadonlyArray<{ id: GroupId; devices: GeneratorChain['devices'] }>,
): Map<GroupId, { id: GroupId; devices: GeneratorChain['devices'] }> => {
  const groupById = new Map<GroupId, { id: GroupId; devices: GeneratorChain['devices'] }>();
  for (const group of groupChains) {
    groupById.set(group.id, group);
  }
  return groupById;
};

const buildGeneratorById = (
  chain: GeneratorChain,
): Map<string, Extract<GeneratorChain['devices'][number], { kind: 'waterdrop' | 'scanner' | 'spiral' }>> => {
  const generatorById = new Map<string, Extract<GeneratorChain['devices'][number], { kind: 'waterdrop' | 'scanner' | 'spiral' }>>();
  for (const device of chain.devices) {
    if (isGeneratorNode(device)) {
      generatorById.set(device.id, device);
    }
  }
  return generatorById;
};

const buildMaskSourceCacheKey = (
  sourceGroupId: string,
  consumingDeviceIndex?: number,
): string => `group:${sourceGroupId}|index:${consumingDeviceIndex ?? -1}`;

const createBaseChainForMaskSource = (
  context: GroupEvaluationContext,
  consumingDeviceIndex: number | undefined,
): GeneratorChain => {
  if (consumingDeviceIndex === undefined) {
    return context.baseChain;
  }

  return {
    devices: context.baseChain.devices.slice(0, consumingDeviceIndex),
    groupStateById: context.baseChain.groupStateById,
  };
};

const createSourceEvaluationContext = (
  sourceChain: GeneratorChain,
  context: GroupEvaluationContext,
  time: number,
  unmutedGroupId: GroupId,
): GroupEvaluationContext => {
  const groupChains = splitChainByGroup(sourceChain);
  const groupById = buildGroupById(groupChains);
  const { mutedGroupIds, mutedGeneratorIds } = resolveMutedSources(sourceChain);

  if (unmutedGroupId) {
    mutedGroupIds.delete(unmutedGroupId);
    const sourceGroup = groupById.get(unmutedGroupId);
    if (sourceGroup) {
      for (const device of sourceGroup.devices) {
        if (isGeneratorNode(device)) {
          mutedGeneratorIds.delete(device.id);
        }
      }
    }
  }

  return {
    time,
    timeReversed: 1 - time,
    buttonIndex: context.buttonIndex,
    chain: sourceChain,
    baseChain: sourceChain,
    groupStateById: sourceChain.groupStateById,
    worldBounds: context.worldBounds,
    groupChains,
    groupById,
    generatorById: buildGeneratorById(sourceChain),
    mutedGroupIds,
    mutedGeneratorIds,
    cache: {
      sceneInstancesByGroup: new Map(),
      checkpointSceneInstancesByIndex: new Map(),
      finalSceneInstances: null,
      outputPolylinesByGroup: new Map(),
      maskSourceOutputNotesByKey: new Map(),
    },
  };
};

const collectGroupOutputNotes = (
  sourceGroupId: string,
  context: GroupEvaluationContext,
  dependencies: MaskSourceOutputDependencies,
  consumingDeviceIndex?: number,
): TimedOutputNote[] => {
  const sourceChain = createBaseChainForMaskSource(context, consumingDeviceIndex);
  const notes: TimedOutputNote[] = collectPitchSampledNotes({
    sampleCount: SAMPLES_PER_BEAT,
    endBeat: 1,
    minimumNoteDuration: MIN_NOTE_DURATION,
    resolveActiveByPitch: (sampleBeat) => {
      const sourceContext = createSourceEvaluationContext(
        sourceChain,
        context,
        sampleBeat,
        sourceGroupId,
      );
      return projectSceneToActivationFrame(
        dependencies.resolveOutputGroupSceneInstances(sourceGroupId, sourceContext),
        sampleBeat,
        context.buttonIndex,
      ).activeByPitch;
    },
  });

  return applyNoteStageColorPrograms(sourceChain, notes, MIN_NOTE_DURATION);
};

export const createMaskSourceOutputResolver = (
  dependencies: MaskSourceOutputDependencies,
): (
  sourceGroupId: string,
  context: GroupEvaluationContext,
  timeKind: MaskTimeKind,
  consumingDeviceIndex?: number,
) => Set<number> => {
  const resolveGroupSourceOutputNotes = (
    sourceGroupId: string,
    context: GroupEvaluationContext,
    consumingDeviceIndex?: number,
  ): ReadonlyArray<TimedOutputNote> => {
    const cacheKey = buildMaskSourceCacheKey(sourceGroupId, consumingDeviceIndex);
    const cached = context.cache.maskSourceOutputNotesByKey.get(cacheKey);
    if (cached) {
      return cached;
    }

    const notes = collectGroupOutputNotes(
      sourceGroupId,
      context,
      dependencies,
      consumingDeviceIndex,
    );
    const fittedNotes = fitNotesToTimeline(notes).fittedNotes;
    context.cache.maskSourceOutputNotesByKey.set(cacheKey, fittedNotes);
    return fittedNotes;
  };

  return (
    sourceGroupId: string,
    context: GroupEvaluationContext,
    timeKind: MaskTimeKind,
    consumingDeviceIndex?: number,
  ): Set<number> => {
    const time = resolveMaskTime(context, timeKind);
    const activeAddresses = new Set<string>();

    for (const note of resolveGroupSourceOutputNotes(
      sourceGroupId,
      context,
      consumingDeviceIndex,
    )) {
      if (note.startBeat <= time && time < note.startBeat + note.durationBeats) {
        activeAddresses.add(`${note.channel}:${note.pitch}`);
      }
    }

    const activeTiles = new Set<number>();
    for (const group of context.buttonIndex.groups) {
      if (group.buttons.some((button) =>
        activeAddresses.has(`${button.output.channel}:${button.output.number}`))) {
        activeTiles.add(group.y * TILE_COUNT + group.x);
      }
    }

    return activeTiles;
  };
};
