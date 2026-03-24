import { splitChainByGroup } from '../../core/pipeline/groups';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import type { ClipNote, ColorEffectNode, GeneratorChain } from '../../shared/model';
import { isGeneratorEngineNode } from '../engine';
import { DEFAULT_COLOR_PARAMS, sanitizeColorGapPercent } from './schema';

export interface ClipNoteWithOrigin extends ClipNote {
  originId?: string;
}

interface ColorProgram {
  notes: ClipNoteWithOrigin[];
}

interface ColorDeviceConfig {
  velocities: number[];
  noteLengthPercent: number;
  gapPercent: number;
}

const DEFAULT_COLOR_VELOCITY = DEFAULT_COLOR_PARAMS.velocities[0];
const DEFAULT_COLOR_NOTE_LENGTH_PERCENT = DEFAULT_COLOR_PARAMS.noteLengthPercent;

const sortNumbersAscending = (left: number, right: number): number => left - right;

const sortClipNotes = <T extends ClipNote>(notes: T[]): void => {
  notes.sort((left, right) =>
    left.startBeat - right.startBeat
    || left.pitch - right.pitch
    || left.channel - right.channel);
};

const sanitizeColorVelocities = (velocities: readonly number[]): number[] => {
  const sanitized = velocities
    .map((slotVelocity) => Number(slotVelocity))
    .filter((slotVelocity) => Number.isFinite(slotVelocity))
    .map((slotVelocity) => Math.round(slotVelocity))
    .filter((slotVelocity) => slotVelocity >= 1 && slotVelocity <= 127);
  return sanitized.length > 0 ? sanitized : [DEFAULT_COLOR_VELOCITY];
};

const sanitizeColorNoteLengthPercent = (value: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? numeric
    : DEFAULT_COLOR_NOTE_LENGTH_PERCENT;
};

const resolveMedianDuration = (
  durations: ReadonlyArray<number>,
): number | null => {
  if (durations.length === 0) {
    return null;
  }

  const orderedDurations = [...durations].sort(sortNumbersAscending);
  const middleIndex = Math.floor(orderedDurations.length / 2);

  if (orderedDurations.length % 2 === 1) {
    return orderedDurations[middleIndex];
  }

  return (orderedDurations[middleIndex - 1] + orderedDurations[middleIndex]) / 2;
};

const groupNotesByOriginId = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
): Map<string, ClipNoteWithOrigin[]> => {
  const notesByOriginId = new Map<string, ClipNoteWithOrigin[]>();

  for (const note of notes) {
    if (!note.originId) {
      continue;
    }

    const originNotes = notesByOriginId.get(note.originId);
    if (originNotes) {
      originNotes.push(note);
      continue;
    }

    notesByOriginId.set(note.originId, [note]);
  }

  return notesByOriginId;
};

const cloneNotes = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
): ClipNoteWithOrigin[] => notes.map((note) => ({ ...note }));

const buildNominalColorProgram = (
  originNotes: ReadonlyArray<ClipNoteWithOrigin>,
  colorConfig: ColorDeviceConfig,
  referenceDuration: number,
  minimumNoteDuration: number,
): ClipNoteWithOrigin[] => {
  const segmentLength = Math.max(
    referenceDuration * (colorConfig.noteLengthPercent / 100),
    minimumNoteDuration,
  );
  const gapDuration = referenceDuration * (colorConfig.gapPercent / 100);
  if (
    !Number.isFinite(segmentLength)
    || segmentLength <= 0
    || !Number.isFinite(gapDuration)
    || gapDuration < 0
  ) {
    return [];
  }

  const programNotes: ClipNoteWithOrigin[] = [];
  for (const note of originNotes) {
    if (!Number.isFinite(note.startBeat)) {
      continue;
    }

    for (let segmentIndex = 0; segmentIndex < colorConfig.velocities.length; segmentIndex += 1) {
      const startBeat = note.startBeat + (segmentIndex * (segmentLength + gapDuration));
      if (!Number.isFinite(startBeat)) {
        break;
      }

      programNotes.push({
        pitch: note.pitch,
        channel: note.channel,
        startBeat,
        durationBeats: segmentLength,
        velocity: colorConfig.velocities[segmentIndex],
        originId: note.originId,
      });
    }
  }

  sortClipNotes(programNotes);
  return programNotes;
};

const fitColorProgramToOriginSpan = (
  sourceNotes: ReadonlyArray<ClipNoteWithOrigin>,
  programNotes: ReadonlyArray<ClipNoteWithOrigin>,
): ColorProgram | null => {
  if (sourceNotes.length === 0 || programNotes.length === 0) {
    return null;
  }

  let sourceStart = Number.POSITIVE_INFINITY;
  let sourceEnd = Number.NEGATIVE_INFINITY;
  for (const note of sourceNotes) {
    if (!Number.isFinite(note.startBeat) || !Number.isFinite(note.durationBeats)) {
      continue;
    }

    sourceStart = Math.min(sourceStart, note.startBeat);
    sourceEnd = Math.max(sourceEnd, note.startBeat + Math.max(note.durationBeats, 0));
  }

  if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= sourceStart) {
    return null;
  }

  let nominalStart = Number.POSITIVE_INFINITY;
  let nominalEnd = Number.NEGATIVE_INFINITY;
  for (const note of programNotes) {
    nominalStart = Math.min(nominalStart, note.startBeat);
    nominalEnd = Math.max(nominalEnd, note.startBeat + Math.max(note.durationBeats, 0));
  }

  if (!Number.isFinite(nominalStart) || !Number.isFinite(nominalEnd) || nominalEnd <= nominalStart) {
    return null;
  }

  const sourceSpan = sourceEnd - sourceStart;
  const nominalSpan = nominalEnd - nominalStart;
  const scale = nominalSpan > sourceSpan
    ? sourceSpan / nominalSpan
    : 1;

  const fitted: ClipNoteWithOrigin[] = [];
  for (const note of programNotes) {
    const startBeat = sourceStart + ((note.startBeat - nominalStart) * scale);
    const scaledDurationBeats = note.durationBeats * scale;
    const clippedStart = Math.max(sourceStart, startBeat);
    const clippedEnd = Math.min(sourceEnd, startBeat + scaledDurationBeats);
    if (
      !Number.isFinite(clippedStart)
      || !Number.isFinite(clippedEnd)
      || clippedEnd <= clippedStart
    ) {
      continue;
    }

    fitted.push({
      pitch: note.pitch,
      channel: note.channel,
      startBeat: clippedStart,
      durationBeats: clippedEnd - clippedStart,
      velocity: note.velocity,
      originId: note.originId,
    });
  }

  return fitted.length === 0 ? null : { notes: fitted };
};

export const applyColorDeviceToNotes = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  device: ColorEffectNode,
  minimumNoteDuration: number,
): ColorProgram | null => {
  if (notes.length === 0) {
    return null;
  }

  const referenceDuration = resolveMedianDuration(
    notes
      .map((note) => note.durationBeats)
      .filter((duration) => Number.isFinite(duration) && duration > 0),
  );
  if (referenceDuration === null) {
    return null;
  }

  if (!notes.some((note) => note.originId)) {
    return null;
  }

  return fitColorProgramToOriginSpan(
    notes,
    buildNominalColorProgram(
      notes,
      {
        velocities: sanitizeColorVelocities(device.params.velocities),
        noteLengthPercent: sanitizeColorNoteLengthPercent(device.params.noteLengthPercent),
        gapPercent: sanitizeColorGapPercent(device.params.gapPercent),
      },
      referenceDuration,
      minimumNoteDuration,
    ),
  );
};

export const applyNoteStageColorPrograms = (
  chain: GeneratorChain,
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  minimumNoteDuration: number,
): ClipNoteWithOrigin[] => {
  if (notes.length === 0) {
    return [];
  }

  const passthroughNotes = notes
    .filter((note) => !note.originId)
    .map((note) => ({ ...note }));
  const notesByOriginId = groupNotesByOriginId(notes);

  for (const group of splitChainByGroup(chain)) {
    const groupChain: GeneratorChain = {
      devices: group.devices,
      groupStateById: chain.groupStateById,
    };
    const upstreamOriginIds: string[] = [];

    for (const device of group.devices) {
      if (!isDeviceEffectivelyEnabled(groupChain, device)) {
        continue;
      }

      if (isGeneratorEngineNode(device)) {
        upstreamOriginIds.push(device.id);
        if (!notesByOriginId.has(device.id)) {
          notesByOriginId.set(device.id, []);
        }
        continue;
      }

      if (device.kind !== 'color') {
        continue;
      }

      for (const originId of upstreamOriginIds) {
        const colorProgram = applyColorDeviceToNotes(
          notesByOriginId.get(originId) ?? [],
          device,
          minimumNoteDuration,
        );
        if (!colorProgram) {
          continue;
        }

        notesByOriginId.set(originId, colorProgram.notes);
      }
    }
  }

  const colorized = [...passthroughNotes];
  for (const originNotes of notesByOriginId.values()) {
    colorized.push(...cloneNotes(originNotes));
  }
  sortClipNotes(colorized);
  return colorized;
};
