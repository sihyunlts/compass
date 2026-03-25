import { MIN_NOTE_DURATION, NOTE_SAMPLES_PER_BEAT } from '../core/pipeline/constants';
import { walkEnabledChainOriginScopes } from '../core/pipeline/origin-timeline-policy';
import { collectPitchSampledNotes } from '../core/pipeline/note-sampling';
import {
  compilePipelineEngine,
  evaluateSceneInstancesAtTime,
  evaluateExactOutputFrameAtTime,
} from '../core/pipeline/engine';
import { applyColorDeviceToNotes, type ClipNoteWithOrigin } from '../devices/color/engine';
import { isDeviceEffectivelyEnabled } from '../shared/group-state';
import type { ColorEffectNode, GeneratorChain } from '../shared/model';
import {
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  type NoteGenerationState,
} from './note-generation-types';
import { sortClipNotes } from './note-utils';

const resolveFinalOutputTimelineEndBeat = (
  state: NoteGenerationState,
  engine: Parameters<typeof evaluateSceneInstancesAtTime>[0],
): number => {
  const analysisSampleCount = Math.max(
    Math.round(state.loopLengthBeats * NOTE_SAMPLES_PER_BEAT),
    NOTE_SAMPLES_PER_BEAT,
  );
  let maxEndBeat = NORMALIZED_SOURCE_TIMELINE_END_BEAT;

  for (let step = 0; step <= analysisSampleCount; step += 1) {
    const sampleBeat = step / analysisSampleCount;
    const sceneInstances = evaluateSceneInstancesAtTime(engine, sampleBeat);

    for (const sceneInstance of sceneInstances) {
      const endBeat = sceneInstance.temporal.visibilityWindow.end;
      if (Number.isFinite(endBeat) && endBeat > maxEndBeat) {
        maxEndBeat = endBeat;
      }
    }
  }

  return maxEndBeat;
};

interface TrailingColorDeviceDescriptor {
  device: ColorEffectNode;
  targetOriginIds: ReadonlySet<string>;
}

const resolveTrailingColorDevices = (
  chain: GeneratorChain,
): TrailingColorDeviceDescriptor[] => {
  const trailingDeviceIds: string[] = [];

  for (let index = chain.devices.length - 1; index >= 0; index -= 1) {
    const device = chain.devices[index];
    if (!isDeviceEffectivelyEnabled(chain, device)) {
      continue;
    }

    if (device.kind !== 'color') {
      break;
    }

    trailingDeviceIds.unshift(device.id);
  }

  if (trailingDeviceIds.length === 0) {
    return [];
  }

  const trailingDeviceIdSet = new Set(trailingDeviceIds);
  const targetOriginIdsByDeviceId = new Map<string, ReadonlySet<string>>();
  walkEnabledChainOriginScopes(chain, {
    onScopedDevice(device, _deviceIndex, targetOriginIds) {
      if (!trailingDeviceIdSet.has(device.id) || device.kind !== 'color') {
        return;
      }

      targetOriginIdsByDeviceId.set(device.id, new Set(targetOriginIds));
    },
  });

  return trailingDeviceIds
    .map((deviceId) => chain.devices.find((device) => device.id === deviceId))
    .filter((device): device is ColorEffectNode => device?.kind === 'color')
    .map((device) => ({
      device,
      targetOriginIds: targetOriginIdsByDeviceId.get(device.id) ?? new Set<string>(),
    }));
};

const buildRawFinalOutputNotes = (
  state: NoteGenerationState,
): ClipNoteWithOrigin[] => {
  if (!Number.isFinite(state.loopLengthBeats) || state.loopLengthBeats <= 0) {
    return [];
  }

  const engine = compilePipelineEngine(state.chain, {
    buttons: state.runtimeMap.buttons,
    buttonIndex: state.runtimeMap.buttonIndex,
  });
  const sourceTimelineEndBeat = resolveFinalOutputTimelineEndBeat(state, engine);
  const sampleCount = Math.ceil(
    state.loopLengthBeats * sourceTimelineEndBeat * NOTE_SAMPLES_PER_BEAT,
  );
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) {
    return [];
  }

  const notes: ClipNoteWithOrigin[] = collectPitchSampledNotes({
    sampleCount,
    endBeat: sourceTimelineEndBeat,
    sampleStepBeats: 1 / NOTE_SAMPLES_PER_BEAT,
    minimumNoteDuration: MIN_NOTE_DURATION,
    resolveActiveByPitch: (sampleBeat) =>
      evaluateExactOutputFrameAtTime(engine, sampleBeat).activationFrame.activeByPitch,
  });

  sortClipNotes(notes);
  return notes;
};

export const buildFinalOutputNotes = (
  state: NoteGenerationState,
): ClipNoteWithOrigin[] => {
  const trailingColorDevices = resolveTrailingColorDevices(state.chain);
  if (trailingColorDevices.length === 0) {
    return buildRawFinalOutputNotes(state);
  }

  const baseChain: GeneratorChain = {
    devices: state.chain.devices.filter((device) =>
      !trailingColorDevices.some(({ device: trailingDevice }) => trailingDevice.id === device.id)),
    groupStateById: state.chain.groupStateById,
  };
  let notes = buildRawFinalOutputNotes({
    ...state,
    chain: baseChain,
  });

  for (const { device, targetOriginIds } of trailingColorDevices) {
    notes = applyColorDeviceToNotes(notes, device, MIN_NOTE_DURATION, targetOriginIds);
  }

  return notes;
};
