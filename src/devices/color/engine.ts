import type { SceneInstance } from '../../core/core-types';
import { projectSceneToActivationFrame } from '../../core/pipeline/active';
import { SAMPLES_PER_BEAT } from '../../core/pipeline/constants';
import { collectPitchSampledNotes } from '../../core/pipeline/note-sampling';
import { composeSceneTemporalState } from '../../core/scene-operators/temporal';
import type { ClipNote, ColorEffectNode } from '../../shared/model';
import type { EffectApplicationContext, EffectDeviceEngineHandler } from '../engine-types';
import { DEFAULT_COLOR_PARAMS, sanitizeColorGapPercent } from './schema';

export interface ClipNoteWithOrigin extends ClipNote {
  originId?: string;
}

interface ColorDeviceConfig {
  velocities: number[];
  noteLengthPercent: number;
  gapPercent: number;
}

interface ColorProgramTiming {
  segmentLength: number;
  gapDuration: number;
}

const DEFAULT_COLOR_VELOCITY = DEFAULT_COLOR_PARAMS.velocities[0];
const DEFAULT_COLOR_NOTE_LENGTH_PERCENT = DEFAULT_COLOR_PARAMS.noteLengthPercent;
const MIN_COLOR_SEGMENT = 1e-4;

const sortNumbersAscending = (left: number, right: number): number => left - right;

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

const buildColorConfig = (
  effect: Parameters<EffectDeviceEngineHandler<'color'>['applyEffect']>[1],
): ColorDeviceConfig => ({
  velocities: sanitizeColorVelocities(effect.params.velocities),
  noteLengthPercent: sanitizeColorNoteLengthPercent(effect.params.noteLengthPercent),
  gapPercent: sanitizeColorGapPercent(effect.params.gapPercent),
});

const resolveMedianDuration = (
  durations: ReadonlyArray<number>,
): number | null => {
  if (durations.length === 0) {
    return null;
  }

  const ordered = [...durations].sort(sortNumbersAscending);
  const middleIndex = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middleIndex]
    : (ordered[middleIndex - 1] + ordered[middleIndex]) / 2;
};

const resolveColorProgramTiming = (
  colorConfig: ColorDeviceConfig,
  referenceDuration: number,
  sourceSpan: number,
): ColorProgramTiming | null => {
  if (
    !Number.isFinite(referenceDuration)
    || referenceDuration <= 0
    || !Number.isFinite(sourceSpan)
    || sourceSpan <= 0
    || colorConfig.velocities.length === 0
  ) {
    return null;
  }

  const nominalSegmentLength = Math.max(
    referenceDuration * (colorConfig.noteLengthPercent / 100),
    MIN_COLOR_SEGMENT,
  );
  const nominalGapDuration = Math.max(
    referenceDuration * (colorConfig.gapPercent / 100),
    0,
  );
  const nominalProgramSpan = nominalSegmentLength
    + (Math.max(colorConfig.velocities.length - 1, 0) * (nominalSegmentLength + nominalGapDuration));
  const scale = nominalProgramSpan > sourceSpan
    ? sourceSpan / nominalProgramSpan
    : 1;
  const segmentLength = nominalSegmentLength * scale;
  const gapDuration = nominalGapDuration * scale;

  return {
    segmentLength,
    gapDuration,
  };
};

const resolveSceneTimelineEndBeat = (
  sceneInstances: ReadonlyArray<SceneInstance>,
): number => {
  let maxEndBeat = 1;

  for (const sceneInstance of sceneInstances) {
    const endBeat = sceneInstance.temporal.visibilityWindow.end;
    if (Number.isFinite(endBeat) && endBeat > maxEndBeat) {
      maxEndBeat = endBeat;
    }
  }

  return maxEndBeat;
};

const collectSourceActivationNotes = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  context: EffectApplicationContext,
): ClipNoteWithOrigin[] => {
  const sourceTimelineEndBeat = resolveSceneTimelineEndBeat(sceneInstances);
  const sampleCount = Math.max(Math.ceil(sourceTimelineEndBeat * SAMPLES_PER_BEAT), SAMPLES_PER_BEAT);

  return collectPitchSampledNotes({
    sampleCount,
    endBeat: sourceTimelineEndBeat,
    sampleStepBeats: 1 / SAMPLES_PER_BEAT,
    minimumNoteDuration: MIN_COLOR_SEGMENT,
    resolveActiveByPitch: (sampleBeat) =>
      projectSceneToActivationFrame(sceneInstances, sampleBeat, context.buttonIndex).activeByPitch,
  });
};

const groupSceneInstancesByOriginId = (
  sceneInstances: ReadonlyArray<SceneInstance>,
): Map<string, SceneInstance[]> => {
  const sceneInstancesByOriginId = new Map<string, SceneInstance[]>();

  for (const sceneInstance of sceneInstances) {
    const existing = sceneInstancesByOriginId.get(sceneInstance.originId);
    if (existing) {
      existing.push(sceneInstance);
      continue;
    }

    sceneInstancesByOriginId.set(sceneInstance.originId, [sceneInstance]);
  }

  return sceneInstancesByOriginId;
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
      existing.push(note);
      continue;
    }

    notesByOriginId.set(note.originId, [note]);
  }

  return notesByOriginId;
};

const buildNominalColorProgram = (
  sourceNotes: ReadonlyArray<ClipNoteWithOrigin>,
  colorConfig: ColorDeviceConfig,
  minimumNoteDuration: number,
): ClipNoteWithOrigin[] => {
  if (sourceNotes.length === 0) {
    return [];
  }

  const referenceDuration = resolveMedianDuration(
    sourceNotes
      .map((note) => note.durationBeats)
      .filter((duration) => Number.isFinite(duration) && duration > 0),
  );
  if (referenceDuration === null) {
    return [];
  }

  let sourceStart = Number.POSITIVE_INFINITY;
  let sourceEnd = Number.NEGATIVE_INFINITY;
  for (const note of sourceNotes) {
    sourceStart = Math.min(sourceStart, note.startBeat);
    sourceEnd = Math.max(sourceEnd, note.startBeat + Math.max(note.durationBeats, 0));
  }

  const timing = resolveColorProgramTiming(colorConfig, referenceDuration, sourceEnd - sourceStart);
  if (!timing) {
    return [];
  }

  const program: ClipNoteWithOrigin[] = [];
  for (const sourceNote of sourceNotes) {
    for (let slotIndex = 0; slotIndex < colorConfig.velocities.length; slotIndex += 1) {
      const startBeat = sourceNote.startBeat + (slotIndex * (timing.segmentLength + timing.gapDuration));
      const endBeat = startBeat + timing.segmentLength;
      if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat) || endBeat <= startBeat) {
        continue;
      }

      program.push({
        pitch: sourceNote.pitch,
        channel: sourceNote.channel,
        startBeat,
        durationBeats: Math.max(timing.segmentLength, minimumNoteDuration),
        velocity: colorConfig.velocities[slotIndex],
        originId: sourceNote.originId,
      });
    }
  }

  return program;
};

export const applyColorDeviceToNotes = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  device: ColorEffectNode,
  minimumNoteDuration: number,
  targetOriginIds?: ReadonlySet<string>,
): ClipNoteWithOrigin[] => {
  if (notes.length === 0) {
    return [];
  }

  const passthrough: ClipNoteWithOrigin[] = [];
  const targetNotes: ClipNoteWithOrigin[] = [];
  for (const note of notes) {
    if (
      !note.originId
      || (targetOriginIds && !targetOriginIds.has(note.originId))
    ) {
      passthrough.push({ ...note });
      continue;
    }

    targetNotes.push(note);
  }

  const colorConfig = buildColorConfig(device);
  const colorized = Array.from(groupNotesByOriginId(targetNotes).values()).flatMap((originNotes) =>
    buildNominalColorProgram(originNotes, colorConfig, minimumNoteDuration));

  return [...passthrough, ...colorized].sort((left, right) =>
    left.startBeat - right.startBeat
    || left.pitch - right.pitch
    || left.channel - right.channel);
};

const createFollowerSceneInstances = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  sourceNotes: ReadonlyArray<ClipNoteWithOrigin>,
  colorConfig: ColorDeviceConfig,
): SceneInstance[] => {
  if (sceneInstances.length === 0 || sourceNotes.length === 0) {
    return [];
  }

  const referenceDuration = resolveMedianDuration(
    sourceNotes
      .map((note) => note.durationBeats)
      .filter((duration) => Number.isFinite(duration) && duration > 0),
  );
  if (referenceDuration === null) {
    return [];
  }

  let sourceStart = Number.POSITIVE_INFINITY;
  let sourceEnd = Number.NEGATIVE_INFINITY;
  for (const note of sourceNotes) {
    sourceStart = Math.min(sourceStart, note.startBeat);
    sourceEnd = Math.max(sourceEnd, note.startBeat + Math.max(note.durationBeats, 0));
  }

  const timing = resolveColorProgramTiming(colorConfig, referenceDuration, sourceEnd - sourceStart);
  if (!timing) {
    return [];
  }

  const followers: SceneInstance[] = [];
  for (const sourceNote of sourceNotes) {
    for (let slotIndex = 0; slotIndex < colorConfig.velocities.length; slotIndex += 1) {
      const offset = slotIndex * (timing.segmentLength + timing.gapDuration);
      const visibilityStart = sourceNote.startBeat + offset;
      const visibilityEnd = visibilityStart + timing.segmentLength;

      if (
        !Number.isFinite(visibilityStart)
        || !Number.isFinite(visibilityEnd)
        || visibilityEnd <= visibilityStart
      ) {
        continue;
      }

      for (const sceneInstance of sceneInstances) {
        followers.push({
          ...sceneInstance,
          velocity: colorConfig.velocities[slotIndex],
          temporal: composeSceneTemporalState(sceneInstance.temporal, {
            remapToInput: {
              kind: 'affine',
              alpha: 1,
              beta: -offset,
            },
            visibilityWindow: {
              start: visibilityStart,
              end: visibilityEnd,
            },
          }),
        });
      }
    }
  }

  return followers;
};

export const colorEngineHandler = {
  kind: 'color',
  applyEffect(sceneInstances, effect, context) {
    if (sceneInstances.length === 0) {
      return [];
    }

    const colorConfig = buildColorConfig(effect);
    const sourceNotesByOriginId = groupNotesByOriginId(
      collectSourceActivationNotes(sceneInstances, context),
    );
    const sceneInstancesByOriginId = groupSceneInstancesByOriginId(sceneInstances);

    return Array.from(sceneInstancesByOriginId.entries()).flatMap(([originId, originSceneInstances]) =>
      createFollowerSceneInstances(
        originSceneInstances,
        sourceNotesByOriginId.get(originId) ?? [],
        colorConfig,
      ));
  },
} satisfies EffectDeviceEngineHandler<'color'>;
