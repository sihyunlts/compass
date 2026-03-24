import {
  MIN_NOTE_DURATION,
  SAMPLES_PER_BEAT,
} from '../core/pipeline/constants';
import {
  compilePipelineEngine,
  evaluateExactOutputFrameAtTime,
  type CompiledPipelineEngine,
} from '../core/pipeline/engine';
import type { ButtonIndex } from '../core/pipeline/types';
import {
  resolveMutedSources,
} from '../core/pipeline/groups';
import {
  applyColorDeviceToNotes,
  type ClipNoteWithOrigin,
} from '../devices/color/engine';
import { fitNotesToTimeline } from '../core/pipeline/timeline-fit';
import { getLaunchpadRuntimeMap } from './launchpad-model';
import { isDeviceEffectivelyEnabled } from '../shared/group-state';
import { normalizeOptionalId } from '../shared/normalize-id';
import type {
  ClipNote,
  GeneratorChain,
  GeneratorDeviceNode,
  LaunchpadButton,
  LaunchpadModel,
  MaskEffectNode,
} from '../shared/model';

/** Statistics summary for generated notes. */
export interface PreviewStats {
  noteCount: number;
  uniquePitchCount: number;
}

export interface GenerateNotesInput {
  chain: GeneratorChain;
  loopLengthBeats: number;
  launchpadModel?: LaunchpadModel;
}

export interface PreviewNotesData {
  notes: ClipNote[];
  sourceTimelineEndBeat: number;
}

interface OpenNoteState {
  pitch: number;
  startBeat: number;
  velocity: number;
  channel: number;
  originId?: string;
}

interface RawNotesData {
  notes: ClipNoteWithOrigin[];
}

interface RuntimeMapData {
  buttons: ReadonlyArray<LaunchpadButton>;
  buttonIndex: ButtonIndex;
  buttonAddressToTileId: Map<string, number>;
}

interface CollectRawNotesInput extends GenerateNotesInput {
  runtimeMap: RuntimeMapData;
}

interface GeneratedNotesContext {
  chain: GeneratorChain;
  loopLengthBeats: number;
  launchpadModel: LaunchpadModel | undefined;
  runtimeMap: RuntimeMapData;
  checkpointNotesCache: Map<number, ClipNoteWithOrigin[]>;
  fittedCheckpointNotesCache: Map<string, ClipNoteWithOrigin[]>;
  originGroupIdByGeneratorId: Map<string, string | null>;
}

export const NORMALIZED_SOURCE_TIMELINE_END_BEAT = 1;

const sortClipNotes = <T extends ClipNote>(notes: T[]): void => {
  notes.sort((left, right) =>
    left.startBeat - right.startBeat
    || left.pitch - right.pitch
    || left.channel - right.channel);
};

const closeOpenNote = (
  notes: ClipNoteWithOrigin[],
  pitch: number,
  open: OpenNoteState,
  endBeat: number,
): void => {
  const orderedStart = Math.max(Math.min(open.startBeat, endBeat), 0);
  const orderedEnd = Math.max(Math.max(open.startBeat, endBeat), 0);
  notes.push({
    pitch,
    channel: open.channel,
    startBeat: orderedStart,
    durationBeats: Math.max(orderedEnd - orderedStart, MIN_NOTE_DURATION),
    velocity: open.velocity,
    originId: open.originId,
  });
};

const toClipNote = (note: ClipNoteWithOrigin): ClipNote => ({
  pitch: note.pitch,
  channel: note.channel,
  startBeat: note.startBeat,
  durationBeats: note.durationBeats,
  velocity: note.velocity,
});

const toAddressKey = (pitch: number, channel: number): string => `${channel}:${pitch}`;

const buildRuntimeMapData = (
  launchpadModel: LaunchpadModel | undefined,
): RuntimeMapData => {
  const runtimeMap = getLaunchpadRuntimeMap(launchpadModel);
  const buttonAddressToTileId = new Map<string, number>();

  for (const button of runtimeMap.buttons) {
    if (button.output.kind !== 'note') {
      continue;
    }

    buttonAddressToTileId.set(
      toAddressKey(button.output.number, button.output.channel),
      (button.y * 10) + button.x,
    );
  }

  return {
    buttons: runtimeMap.buttons,
    buttonIndex: runtimeMap.buttonIndex,
    buttonAddressToTileId,
  };
};

const buildEngine = (
  chain: GeneratorChain,
  runtimeMap: RuntimeMapData,
): CompiledPipelineEngine => {
  return compilePipelineEngine(chain, {
    buttons: runtimeMap.buttons,
    buttonIndex: runtimeMap.buttonIndex,
  });
};

const collectRawNotesData = ({
  chain,
  loopLengthBeats,
  runtimeMap,
}: CollectRawNotesInput): RawNotesData => {
  if (!Number.isFinite(loopLengthBeats) || loopLengthBeats <= 0) {
    return { notes: [] };
  }

  const steps = Math.round(loopLengthBeats * SAMPLES_PER_BEAT);
  if (!Number.isFinite(steps) || steps <= 0) {
    return { notes: [] };
  }

  const engine = buildEngine(chain, runtimeMap);
  const openByPitch = new Map<number, OpenNoteState>();
  const notes: ClipNoteWithOrigin[] = [];

  for (let step = 0; step < steps; step += 1) {
    const t01 = step / steps;
    const activeByPitch = evaluateExactOutputFrameAtTime(
      engine,
      t01,
    ).activationFrame.activeByPitch;

    for (const [pitch, open] of openByPitch.entries()) {
      if (activeByPitch.has(pitch)) {
        continue;
      }
      closeOpenNote(notes, pitch, open, t01);
      openByPitch.delete(pitch);
    }

    for (const [pitch, active] of activeByPitch.entries()) {
      const existing = openByPitch.get(pitch);
      if (!existing) {
        openByPitch.set(pitch, {
          pitch,
          startBeat: t01,
          velocity: active.velocity,
          channel: active.channel,
          originId: active.originId,
        });
        continue;
      }

      if (
        existing.velocity === active.velocity
        && existing.channel === active.channel
        && existing.originId === active.originId
      ) {
        continue;
      }

      closeOpenNote(notes, pitch, existing, t01);
      openByPitch.set(pitch, {
        pitch,
        startBeat: t01,
        velocity: active.velocity,
        channel: active.channel,
        originId: active.originId,
      });
    }
  }

  for (const [pitch, open] of openByPitch.entries()) {
    closeOpenNote(notes, pitch, open, NORMALIZED_SOURCE_TIMELINE_END_BEAT);
  }

  sortClipNotes(notes);
  return { notes };
};

const createInputForChain = (
  chain: GeneratorChain,
  context: GeneratedNotesContext,
): CollectRawNotesInput => ({
  chain,
  loopLengthBeats: context.loopLengthBeats,
  launchpadModel: context.launchpadModel,
  runtimeMap: context.runtimeMap,
});

const cloneNotes = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
): ClipNoteWithOrigin[] => notes.map((note) => ({ ...note }));

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

const resolveActiveTileIdsAtBeat = (
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
      toAddressKey(note.pitch, note.channel),
    );
    if (tileId !== undefined) {
      activeTiles.add(tileId);
    }
  }

  return activeTiles;
};

const filterNotesByMask = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  effect: MaskEffectNode,
  runtimeMap: RuntimeMapData,
  resolveMaskTilesAtBeat: (beat: number) => ReadonlySet<number>,
): ClipNoteWithOrigin[] => {
  if (notes.length === 0) {
    return [];
  }

  const openByAddress = new Map<string, OpenNoteState>();
  const filtered: ClipNoteWithOrigin[] = [];

  for (let step = 0; step < SAMPLES_PER_BEAT; step += 1) {
    const beat = step / SAMPLES_PER_BEAT;
    const maskTiles = resolveMaskTilesAtBeat(beat);
    const activeByAddress = new Map<string, ClipNoteWithOrigin>();

    for (const note of notes) {
      if (!(note.startBeat <= beat && beat < note.startBeat + note.durationBeats)) {
        continue;
      }

      const addressKey = toAddressKey(note.pitch, note.channel);
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
      closeOpenNote(filtered, open.pitch, open, beat);
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
        closeOpenNote(filtered, existing.pitch, existing, beat);
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

  for (const [addressKey, open] of openByAddress.entries()) {
    void addressKey;
    closeOpenNote(filtered, open.pitch, open, NORMALIZED_SOURCE_TIMELINE_END_BEAT);
  }

  sortClipNotes(filtered);
  return filtered;
};

const isGeneratorNode = (
  device: GeneratorDeviceNode,
): boolean => (
  device.kind === 'waterdrop'
  || device.kind === 'scanner'
  || device.kind === 'spiral'
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

const buildOriginGroupIdByGeneratorId = (
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

const groupNotesByOriginId = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
): Map<string, ClipNoteWithOrigin[]> => {
  const notesByOriginId = new Map<string, ClipNoteWithOrigin[]>();

  for (const note of notes) {
    if (!note.originId) {
      continue;
    }

    const existing = notesByOriginId.get(note.originId);
    if (existing) {
      existing.push({ ...note });
      continue;
    }

    notesByOriginId.set(note.originId, [{ ...note }]);
  }

  return notesByOriginId;
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

const filterNotesByOriginIds = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  originIds: ReadonlySet<string>,
): ClipNoteWithOrigin[] => notes.filter((note) =>
  note.originId ? originIds.has(note.originId) : false).map((note) => ({ ...note }));

const resolveSourceOriginIds = (
  context: GeneratedNotesContext,
  sourceKind: 'group' | 'generator',
  sourceId: string,
): Set<string> => {
  if (sourceKind === 'generator') {
    return new Set([sourceId]);
  }

  const originIds = new Set<string>();
  for (const [originId, groupId] of context.originGroupIdByGeneratorId.entries()) {
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
  cache: Map<string, ClipNoteWithOrigin[]>,
  cacheKey: string,
): ClipNoteWithOrigin[] => {
  const cached = cache.get(cacheKey);
  if (cached) {
    return cloneNotes(cached);
  }

  const fitted = fitNotesToTimeline(notes).fittedNotes;
  cache.set(cacheKey, fitted);
  return cloneNotes(fitted);
};

const evaluateCheckpointNotes = (
  context: GeneratedNotesContext,
  endExclusive: number,
): ClipNoteWithOrigin[] => {
  const cached = context.checkpointNotesCache.get(endExclusive);
  if (cached) {
    return cloneNotes(cached);
  }

  const geometryOnlyChain = buildGeometryOnlyCheckpointChain(context.chain, endExclusive);
  const rawNotes = collectRawNotesData(createInputForChain(geometryOnlyChain, context)).notes;
  const notesByOriginId = groupNotesByOriginId(rawNotes);
  const upstreamOriginIds: string[] = [];
  const prefixDevices = context.chain.devices.slice(0, endExclusive);

  for (let index = 0; index < prefixDevices.length; index += 1) {
    const device = prefixDevices[index];
    if (!isDeviceEffectivelyEnabled(context.chain, device)) {
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
      context.originGroupIdByGeneratorId,
      upstreamOriginIds,
      device.groupId,
    );
    if (targetOriginIds.length === 0) {
      continue;
    }

    if (device.kind === 'color') {
      for (const originId of targetOriginIds) {
        const colorized = applyColorToCurrentNotes(
          notesByOriginId.get(originId) ?? [],
          device,
        );
        notesByOriginId.set(originId, colorized);
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
        evaluateCheckpointNotes(context, index),
        resolveSourceOriginIds(context, device.params.sourceKind, sourceId),
      ),
      context.fittedCheckpointNotesCache,
      buildFittedCheckpointCacheKey(index, device.params.sourceKind, sourceId),
    );

    for (const originId of targetOriginIds) {
      notesByOriginId.set(
        originId,
        filterNotesByMask(
          notesByOriginId.get(originId) ?? [],
          device,
          context.runtimeMap,
          (beat) => resolveActiveTileIdsAtBeat(sourceNotes, beat, context.runtimeMap),
        ),
      );
    }
  }

  const notes: ClipNoteWithOrigin[] = [];
  for (const originId of upstreamOriginIds) {
    notes.push(...cloneNotes(notesByOriginId.get(originId) ?? []));
  }
  sortClipNotes(notes);
  context.checkpointNotesCache.set(endExclusive, notes);
  return cloneNotes(notes);
};

const buildFinalOutputNotes = (
  context: GeneratedNotesContext,
): ClipNoteWithOrigin[] => {
  const { mutedGroupIds, mutedGeneratorIds } = resolveMutedSources(context.chain);
  const notes = evaluateCheckpointNotes(context, context.chain.devices.length)
    .filter((note) => {
      if (!note.originId) {
        return true;
      }

      if (mutedGeneratorIds.has(note.originId)) {
        return false;
      }

      const groupId = context.originGroupIdByGeneratorId.get(note.originId);
      return !groupId || !mutedGroupIds.has(groupId);
    });
  sortClipNotes(notes);
  return notes;
};

const buildGeneratedNotes = ({
  chain,
  loopLengthBeats,
  launchpadModel,
}: GenerateNotesInput): {
  notes: ClipNoteWithOrigin[];
  sourceTimelineEndBeat: number;
} => {
  if (!Number.isFinite(loopLengthBeats) || loopLengthBeats <= 0) {
    return {
      notes: [],
      sourceTimelineEndBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
    };
  }

  const steps = Math.round(loopLengthBeats * SAMPLES_PER_BEAT);
  if (!Number.isFinite(steps) || steps <= 0) {
    return {
      notes: [],
      sourceTimelineEndBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
    };
  }

  const runtimeMap = buildRuntimeMapData(launchpadModel);
  const generatedNotesContext: GeneratedNotesContext = {
    chain,
    loopLengthBeats,
    launchpadModel,
    runtimeMap,
    checkpointNotesCache: new Map(),
    fittedCheckpointNotesCache: new Map(),
    originGroupIdByGeneratorId: buildOriginGroupIdByGeneratorId(chain),
  };
  const outputNotes = buildFinalOutputNotes(generatedNotesContext);
  const fitted = fitNotesToTimeline(outputNotes);

  return {
    notes: fitted.fittedNotes,
    sourceTimelineEndBeat: fitted.exportTargetSpan,
  };
};

/** Generates clip notes from one chain and one Launchpad model. */
export const generatePreviewNotesData = ({
  chain,
  loopLengthBeats,
  launchpadModel,
}: GenerateNotesInput): PreviewNotesData => {
  const generated = buildGeneratedNotes({
    chain,
    loopLengthBeats,
    launchpadModel,
  });

  return {
    notes: generated.notes.map((note) => toClipNote(note)),
    sourceTimelineEndBeat: generated.sourceTimelineEndBeat,
  };
};

/** Generates clip notes from one chain and one Launchpad model. */
export const generateNotes = ({
  chain,
  loopLengthBeats,
  launchpadModel,
}: GenerateNotesInput): ClipNote[] => generatePreviewNotesData({
  chain,
  loopLengthBeats,
  launchpadModel,
}).notes;

/** Counts total notes and unique pitches (deduped by pitch value). */
export const generatePreviewStats = (notes: ReadonlyArray<ClipNote>): PreviewStats => {
  const uniquePitches = new Set<number>();
  for (const note of notes) {
    uniquePitches.add(note.pitch);
  }

  return {
    noteCount: notes.length,
    uniquePitchCount: uniquePitches.size,
  };
};
