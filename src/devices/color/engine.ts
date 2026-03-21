import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type { ClipNote, GeneratorChain } from '../../shared/model';
import { isGeneratorEngineNode } from '../engine';
import { DEFAULT_COLOR_PARAMS, sanitizeColorGapPercent } from './schema';

export interface ClipNoteWithOrigin extends ClipNote {
  originId?: string;
}

export interface ColorGuideWarp {
  sourceStartBeat: number;
  sourceEndBeat: number;
  scale: number;
}

interface ColorOriginConfig {
  velocities: number[];
  noteLengthPercent: number;
  gapPercent: number;
}

interface ColorProgram {
  notes: ClipNoteWithOrigin[];
  guideWarp: ColorGuideWarp;
}

interface AppliedColorProgramsResult {
  notes: ClipNoteWithOrigin[];
  colorGuideWarpByOriginId: ReadonlyMap<string, ColorGuideWarp>;
}

const DEFAULT_COLOR_VELOCITY = DEFAULT_COLOR_PARAMS.velocities[0];
const DEFAULT_COLOR_NOTE_LENGTH_PERCENT = DEFAULT_COLOR_PARAMS.noteLengthPercent;

const sortNumbersAscending = (left: number, right: number): number => left - right;

const toClipNote = (note: ClipNoteWithOrigin): ClipNote => ({
  pitch: note.pitch,
  channel: note.channel,
  startBeat: note.startBeat,
  durationBeats: note.durationBeats,
  velocity: note.velocity,
});

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

const isColorDevice = (
  device: GeneratorChain['devices'][number],
): device is Extract<GeneratorChain['devices'][number], { kind: 'color' }> =>
  device.kind === 'color';

const resolveColorConfigByOriginId = (
  chain: GeneratorChain,
): Map<string, ColorOriginConfig> => {
  const devicesByGroupId = new Map<string | null, Array<GeneratorChain['devices'][number]>>();
  for (const device of chain.devices) {
    const groupId = normalizeOptionalId(device.groupId);
    const groupDevices = devicesByGroupId.get(groupId);
    if (groupDevices) {
      groupDevices.push(device);
      continue;
    }
    devicesByGroupId.set(groupId, [device]);
  }

  const configByOriginId = new Map<string, ColorOriginConfig>();
  for (const groupDevices of devicesByGroupId.values()) {
    let accumulatedVelocities: number[] = [];
    let accumulatedNoteLengthPercent: number | null = null;
    let accumulatedGapPercent: number | null = null;

    for (let index = groupDevices.length - 1; index >= 0; index -= 1) {
      const device = groupDevices[index];
      if (!isDeviceEffectivelyEnabled(chain, device)) {
        continue;
      }

      if (isColorDevice(device)) {
        const velocities = sanitizeColorVelocities(device.params.velocities);
        accumulatedVelocities = [...velocities, ...accumulatedVelocities];
        accumulatedNoteLengthPercent = sanitizeColorNoteLengthPercent(
          device.params.noteLengthPercent,
        );
        accumulatedGapPercent = sanitizeColorGapPercent(device.params.gapPercent);
        continue;
      }

      if (!isGeneratorEngineNode(device) || accumulatedVelocities.length === 0) {
        continue;
      }

      configByOriginId.set(device.id, {
        velocities: [...accumulatedVelocities],
        noteLengthPercent: accumulatedNoteLengthPercent,
        gapPercent: accumulatedGapPercent ?? DEFAULT_COLOR_PARAMS.gapPercent,
      });
    }
  }

  return configByOriginId;
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

const resolveMedianDurationByOriginId = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
): Map<string, number> => {
  const durationsByOriginId = new Map<string, number[]>();

  for (const note of notes) {
    if (!note.originId || !Number.isFinite(note.durationBeats) || note.durationBeats <= 0) {
      continue;
    }

    const originDurations = durationsByOriginId.get(note.originId);
    if (originDurations) {
      originDurations.push(note.durationBeats);
      continue;
    }

    durationsByOriginId.set(note.originId, [note.durationBeats]);
  }

  const medianDurationByOriginId = new Map<string, number>();
  for (const [originId, durations] of durationsByOriginId.entries()) {
    const medianDuration = resolveMedianDuration(durations);
    if (medianDuration === null) {
      continue;
    }
    medianDurationByOriginId.set(originId, medianDuration);
  }

  return medianDurationByOriginId;
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

const buildNominalColorProgram = (
  originNotes: ReadonlyArray<ClipNoteWithOrigin>,
  colorConfig: ColorOriginConfig,
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

  return programNotes.sort((left, right) =>
    left.startBeat - right.startBeat
    || left.pitch - right.pitch
    || left.channel - right.channel);
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

  return {
    notes: fitted,
    guideWarp: {
      sourceStartBeat: sourceStart,
      sourceEndBeat: sourceEnd,
      scale,
    },
  };
};

const buildColorProgramByOriginId = (
  chain: GeneratorChain,
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  minimumNoteDuration: number,
): Map<string, ColorProgram> => {
  if (notes.length === 0) {
    return new Map();
  }

  const colorConfigByOriginId = resolveColorConfigByOriginId(chain);
  if (colorConfigByOriginId.size === 0) {
    return new Map();
  }

  const medianDurationByOriginId = resolveMedianDurationByOriginId(notes);
  if (medianDurationByOriginId.size === 0) {
    return new Map();
  }

  const notesByOriginId = groupNotesByOriginId(notes);
  const colorProgramByOriginId = new Map<string, ColorProgram>();

  for (const [originId, originNotes] of notesByOriginId.entries()) {
    const colorConfig = colorConfigByOriginId.get(originId);
    const referenceDuration = medianDurationByOriginId.get(originId);
    if (!colorConfig || referenceDuration === undefined) {
      continue;
    }

    const nominalProgram = buildNominalColorProgram(
      originNotes,
      colorConfig,
      referenceDuration,
      minimumNoteDuration,
    );
    if (nominalProgram.length === 0) {
      continue;
    }

    const fittedProgram = fitColorProgramToOriginSpan(originNotes, nominalProgram);
    if (!fittedProgram || fittedProgram.notes.length === 0) {
      continue;
    }

    colorProgramByOriginId.set(originId, fittedProgram);
  }

  return colorProgramByOriginId;
};

export const applyColorProgramsDetailed = (
  chain: GeneratorChain,
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  minimumNoteDuration: number,
): AppliedColorProgramsResult => {
  if (notes.length === 0) {
    return {
      notes: [],
      colorGuideWarpByOriginId: new Map(),
    };
  }

  const colorProgramByOriginId = buildColorProgramByOriginId(
    chain,
    notes,
    minimumNoteDuration,
  );
  if (colorProgramByOriginId.size === 0) {
    return {
      notes: notes.map((note) => ({ ...note })),
      colorGuideWarpByOriginId: new Map(),
    };
  }

  const colorized: ClipNoteWithOrigin[] = [];
  const emittedOriginIds = new Set<string>();
  const colorGuideWarpByOriginId = new Map<string, ColorGuideWarp>();

  for (const note of notes) {
    if (!note.originId) {
      colorized.push({ ...note });
      continue;
    }

    const colorProgram = colorProgramByOriginId.get(note.originId);
    if (!colorProgram) {
      colorized.push({ ...note });
      continue;
    }

    if (emittedOriginIds.has(note.originId)) {
      continue;
    }

    colorized.push(...colorProgram.notes);
    colorGuideWarpByOriginId.set(note.originId, colorProgram.guideWarp);
    emittedOriginIds.add(note.originId);
  }

  return {
    notes: colorized,
    colorGuideWarpByOriginId,
  };
};

export const applyColorProgramsWithOrigins = (
  chain: GeneratorChain,
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  minimumNoteDuration: number,
): ClipNoteWithOrigin[] => applyColorProgramsDetailed(chain, notes, minimumNoteDuration).notes;

export const applyColorPrograms = (
  chain: GeneratorChain,
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  minimumNoteDuration: number,
): ClipNote[] => applyColorProgramsDetailed(chain, notes, minimumNoteDuration).notes.map((note) =>
  toClipNote(note));
