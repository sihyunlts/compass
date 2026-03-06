import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type { ClipNote, GeneratorChain } from '../../shared/model';
import { isGeneratorEngineNode } from '../engine';

export interface ClipNoteWithOrigin extends ClipNote {
  originId?: string;
}

interface ColorOriginConfig {
  velocities: number[];
  noteLengthPercent: number;
}

const DEFAULT_COLOR_VELOCITY = 3;
const DEFAULT_COLOR_NOTE_LENGTH_PERCENT = 100;

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

    for (let index = groupDevices.length - 1; index >= 0; index -= 1) {
      const device = groupDevices[index];
      if (!isDeviceEffectivelyEnabled(chain, device)) {
        continue;
      }

      if (isColorDevice(device)) {
        const velocities = sanitizeColorVelocities(device.params.velocities ?? []);
        accumulatedVelocities = [...velocities, ...accumulatedVelocities];
        accumulatedNoteLengthPercent = sanitizeColorNoteLengthPercent(
          device.params.noteLengthPercent,
        );
        continue;
      }

      if (!isGeneratorEngineNode(device) || accumulatedVelocities.length === 0) {
        continue;
      }

      configByOriginId.set(device.id, {
        velocities: [...accumulatedVelocities],
        noteLengthPercent: accumulatedNoteLengthPercent ?? DEFAULT_COLOR_NOTE_LENGTH_PERCENT,
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

export const applyColorDevices = (
  chain: GeneratorChain,
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  minimumNoteDuration: number,
): ClipNote[] => {
  if (notes.length === 0) {
    return [];
  }

  const colorConfigByOriginId = resolveColorConfigByOriginId(chain);
  if (colorConfigByOriginId.size === 0) {
    return notes.map((note) => toClipNote(note));
  }

  const medianDurationByOriginId = resolveMedianDurationByOriginId(notes);
  if (medianDurationByOriginId.size === 0) {
    return notes.map((note) => toClipNote(note));
  }

  const colorized: ClipNote[] = [];

  for (const note of notes) {
    if (!note.originId) {
      colorized.push(toClipNote(note));
      continue;
    }

    const colorConfig = colorConfigByOriginId.get(note.originId);
    if (!colorConfig) {
      colorized.push(toClipNote(note));
      continue;
    }

    const referenceDuration = medianDurationByOriginId.get(note.originId);
    if (referenceDuration === undefined) {
      colorized.push(toClipNote(note));
      continue;
    }

    const segmentLength = Math.max(
      referenceDuration * (colorConfig.noteLengthPercent / 100),
      minimumNoteDuration,
    );
    if (!Number.isFinite(note.startBeat) || !Number.isFinite(segmentLength) || segmentLength <= 0) {
      colorized.push(toClipNote(note));
      continue;
    }

    const velocities = colorConfig.velocities;
    if (velocities.length === 0) {
      colorized.push(toClipNote(note));
      continue;
    }

    for (let segmentIndex = 0; segmentIndex < velocities.length; segmentIndex += 1) {
      const segmentStart = note.startBeat + segmentIndex * segmentLength;
      if (!Number.isFinite(segmentStart)) {
        break;
      }

      colorized.push({
        pitch: note.pitch,
        channel: note.channel,
        startBeat: segmentStart,
        durationBeats: segmentLength,
        velocity: velocities[segmentIndex],
      });
    }
  }

  return colorized;
};
