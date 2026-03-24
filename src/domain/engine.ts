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
  splitChainByGroup,
} from '../core/pipeline/groups';
import {
  applyColorDeviceToNotes,
  applyNoteStageColorPrograms,
  type ClipNoteWithOrigin,
} from '../devices/color/engine';
import { fitNotesToTimeline } from '../core/pipeline/timeline-fit';
import { getLaunchpadRuntimeMap } from './launchpad-model';
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
  groupOutputNotesCache: Map<string, ClipNoteWithOrigin[]>;
  fittedGroupOutputNotesCache: Map<string, ClipNoteWithOrigin[]>;
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

const supportsNoteStageTail = (
  devices: ReadonlyArray<GeneratorDeviceNode>,
): boolean => {
  let sawColor = false;

  for (const device of devices) {
    if (device.enabled === false) {
      continue;
    }

    if (device.kind === 'color') {
      sawColor = true;
      continue;
    }

    if (!sawColor) {
      continue;
    }

    if (device.kind === 'mask') {
      continue;
    }

    return false;
  }

  return sawColor;
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

const buildGroupSliceChain = (
  groupDevices: ReadonlyArray<GeneratorDeviceNode>,
  groupStateById: GeneratorChain['groupStateById'],
  endExclusive: number,
): GeneratorChain => ({
  devices: groupDevices.slice(0, endExclusive).map((device) => ({ ...device })),
  groupStateById,
});

const buildGroupOutputCacheKey = (
  groupId: string | null,
  endExclusive: number,
): string => `${groupId ?? 'root'}:${endExclusive}`;

const fitCachedNotesToTimeline = (
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

const buildGroupOutputNotes = (
  context: GeneratedNotesContext,
  groupId: string | null,
  endExclusive?: number,
): ClipNoteWithOrigin[] => {
  const group = splitChainByGroup(context.chain).find((entry) => entry.id === groupId);
  if (!group) {
    return [];
  }

  const sliceEndExclusive = endExclusive ?? group.devices.length;
  const cacheKey = buildGroupOutputCacheKey(groupId, sliceEndExclusive);
  const cached = context.groupOutputNotesCache.get(cacheKey);
  if (cached) {
    return cloneNotes(cached);
  }

  const sliceChain = buildGroupSliceChain(
    group.devices,
    context.chain.groupStateById,
    sliceEndExclusive,
  );
  const colorStartIndex = sliceChain.devices.findIndex((device) =>
    device.enabled !== false && device.kind === 'color');
  const needsNoteStageTail =
    colorStartIndex >= 0 && supportsNoteStageTail(sliceChain.devices.slice(colorStartIndex));

  let result: ClipNoteWithOrigin[];
  if (!needsNoteStageTail) {
    result = applyNoteStageColorPrograms(
      sliceChain,
      collectRawNotesData(createInputForChain(sliceChain, context)).notes,
      MIN_NOTE_DURATION,
    );
  } else {
    const prefixChain = buildGroupSliceChain(
      sliceChain.devices,
      sliceChain.groupStateById,
      colorStartIndex,
    );
    let currentNotes = collectRawNotesData(createInputForChain(prefixChain, context)).notes;

    for (let index = colorStartIndex; index < sliceChain.devices.length; index += 1) {
      const device = sliceChain.devices[index];
      if (device.enabled === false) {
        continue;
      }

      if (device.kind === 'color') {
        currentNotes = applyColorToCurrentNotes(currentNotes, device);
        continue;
      }

      if (device.kind !== 'mask') {
        currentNotes = applyNoteStageColorPrograms(
          sliceChain,
          collectRawNotesData(createInputForChain(sliceChain, context)).notes,
          MIN_NOTE_DURATION,
        );
        break;
      }

      const fittedCurrentNotes = fitNotesToTimeline(currentNotes).fittedNotes;
      let maskSourceNotes: ReadonlyArray<ClipNoteWithOrigin> | null = null;
      if (device.params.sourceKind === 'generator') {
        const generatorChain: GeneratorChain = {
          devices: context.chain.devices.filter((entry) => entry.id === device.params.sourceId),
          groupStateById: context.chain.groupStateById,
        };
        maskSourceNotes = fitNotesToTimeline(
          applyNoteStageColorPrograms(
            generatorChain,
            collectRawNotesData(createInputForChain(generatorChain, context)).notes,
            MIN_NOTE_DURATION,
          ),
        ).fittedNotes;
      } else if (device.params.sourceKind === 'group') {
        const sourceGroupId = device.params.sourceId ?? null;
        maskSourceNotes = sourceGroupId === groupId
          ? fittedCurrentNotes
          : buildFittedGroupOutputNotes(context, sourceGroupId);
      }

      const resolveMaskTilesAtBeat = (beat: number): ReadonlySet<number> => {
        if (device.params.sourceKind === 'tiles') {
          return new Set(device.params.tiles);
        }

        if (maskSourceNotes) {
          return resolveActiveTileIdsAtBeat(
            maskSourceNotes,
            beat,
            context.runtimeMap,
          );
        }

        return new Set();
      };

      currentNotes = filterNotesByMask(
        currentNotes,
        device,
        context.runtimeMap,
        (beat) => resolveMaskTilesAtBeat(beat),
      );
    }

    result = currentNotes;
  }

  context.groupOutputNotesCache.set(cacheKey, result);
  return cloneNotes(result);
};

const buildFittedGroupOutputNotes = (
  context: GeneratedNotesContext,
  groupId: string | null,
  endExclusive?: number,
): ClipNoteWithOrigin[] => {
  const group = splitChainByGroup(context.chain).find((entry) => entry.id === groupId);
  if (!group) {
    return [];
  }

  const sliceEndExclusive = endExclusive ?? group.devices.length;
  const cacheKey = buildGroupOutputCacheKey(groupId, sliceEndExclusive);
  return fitCachedNotesToTimeline(
    buildGroupOutputNotes(context, groupId, sliceEndExclusive),
    context.fittedGroupOutputNotesCache,
    cacheKey,
  );
};

const buildFinalOutputNotes = (
  context: GeneratedNotesContext,
): ClipNoteWithOrigin[] => {
  const { mutedGroupIds, mutedGeneratorIds } = resolveMutedSources(context.chain);
  const outputNotes: ClipNoteWithOrigin[] = [];

  for (const group of splitChainByGroup(context.chain)) {
    if (group.id && mutedGroupIds.has(group.id)) {
      continue;
    }

    const groupNotes = buildGroupOutputNotes(context, group.id);
    for (const note of groupNotes) {
      if (note.originId && mutedGeneratorIds.has(note.originId)) {
        continue;
      }
      outputNotes.push(note);
    }
  }

  sortClipNotes(outputNotes);
  return outputNotes;
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
    groupOutputNotesCache: new Map(),
    fittedGroupOutputNotesCache: new Map(),
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
