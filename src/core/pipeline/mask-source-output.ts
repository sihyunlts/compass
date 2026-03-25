import type { GeneratorChain } from '../../shared/model';
import { buildGeneratedNotesWithRuntimeMap } from '../../domain/note-export';
import { buildRuntimeMapDataFromButtonIndex } from '../../domain/runtime-map';
import { TILE_COUNT } from './constants';
import { isGeneratorNode, resolveMaskTime, splitChainByGroup } from './groups';
import type {
  GroupEvaluationContext,
  MaskTimeKind,
  TimedOutputNote,
} from './types';

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

const collectGroupOutputNotes = (
  sourceGroupId: string,
  sourceChain: GeneratorChain,
  context: GroupEvaluationContext,
): TimedOutputNote[] => {
  const sourceOriginIds = new Set(
    splitChainByGroup(sourceChain)
      .find((group) => group.id === sourceGroupId)
      ?.devices
      .filter((device) => isGeneratorNode(device))
      .map((device) => device.id) ?? [],
  );
  if (sourceOriginIds.size === 0) {
    return [];
  }

  return buildGeneratedNotesWithRuntimeMap({
    chain: sourceChain,
    loopLengthBeats: 1,
    runtimeMap: buildRuntimeMapDataFromButtonIndex(context.buttonIndex),
  }).notes.filter((note) => note.originId && sourceOriginIds.has(note.originId));
};

export const createMaskSourceOutputResolver = (): (
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

    const sourceChain = createBaseChainForMaskSource(context, consumingDeviceIndex);
    const notes = collectGroupOutputNotes(
      sourceGroupId,
      sourceChain,
      context,
    );
    context.cache.maskSourceOutputNotesByKey.set(cacheKey, notes);
    return notes;
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
