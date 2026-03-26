import type { SceneInstance } from '../../core/core-types';
import { projectSceneToActivationFrame } from '../../core/pipeline/active';
import { NOTE_SAMPLES_PER_BEAT } from '../../core/pipeline/constants';
import { collectPitchSampledNotes } from '../../core/pipeline/note-sampling';
import { composeSceneTemporalState } from '../../core/scene-operators/temporal';
import type { ColorEffectNode } from '../../shared/model';
import type { EffectApplicationContext, EffectDeviceEngineHandler } from '../engine-types';
import {
  buildColorConfig,
  planColorProgramSlots,
  type ClipNoteWithOrigin,
} from './color-program';

const MIN_COLOR_SEGMENT = 1e-4;

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
  const sampleCount = Math.max(
    Math.ceil(sourceTimelineEndBeat * NOTE_SAMPLES_PER_BEAT),
    NOTE_SAMPLES_PER_BEAT,
  );

  return collectPitchSampledNotes({
    sampleCount,
    endBeat: sourceTimelineEndBeat,
    sampleStepBeats: 1 / NOTE_SAMPLES_PER_BEAT,
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

const createFollowerSceneInstances = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  sourceNotes: ReadonlyArray<ClipNoteWithOrigin>,
  effect: ColorEffectNode,
): SceneInstance[] => {
  if (sceneInstances.length === 0 || sourceNotes.length === 0) {
    return [];
  }

  const plannedSlots = planColorProgramSlots(sourceNotes, buildColorConfig(effect));
  if (plannedSlots.length === 0) {
    return [];
  }

  const followers: SceneInstance[] = [];
  for (const slot of plannedSlots) {
    for (const sceneInstance of sceneInstances) {
      followers.push({
        ...sceneInstance,
        velocity: slot.velocity,
        temporal: composeSceneTemporalState(sceneInstance.temporal, {
          remapToInput: {
            kind: 'affine',
            alpha: 1,
            beta: -slot.offset,
          },
          visibilityWindow: {
            start: slot.startBeat,
            end: slot.endBeat,
          },
        }),
      });
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

    const sourceNotesByOriginId = groupNotesByOriginId(
      collectSourceActivationNotes(sceneInstances, context),
    );
    const sceneInstancesByOriginId = groupSceneInstancesByOriginId(sceneInstances);

    return Array.from(sceneInstancesByOriginId.entries()).flatMap(([originId, originSceneInstances]) =>
      createFollowerSceneInstances(
        originSceneInstances,
        sourceNotesByOriginId.get(originId) ?? [],
        effect,
      ));
  },
} satisfies EffectDeviceEngineHandler<'color'>;
