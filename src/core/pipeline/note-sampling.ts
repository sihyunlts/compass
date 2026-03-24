export interface SampledActivePitch {
  velocity: number;
  channel: number;
  originId?: string;
}

export interface SampledOpenNoteState extends SampledActivePitch {
  startBeat: number;
}

export interface SampledTimedNote extends SampledOpenNoteState {
  pitch: number;
  durationBeats: number;
}

interface CollectPitchSampledNotesOptions {
  sampleCount: number;
  endBeat: number;
  minimumNoteDuration: number;
  resolveActiveByPitch: (sampleBeat: number) => ReadonlyMap<number, SampledActivePitch>;
}

const hasSameNoteState = (
  left: SampledOpenNoteState,
  right: SampledActivePitch,
): boolean => (
  left.velocity === right.velocity
  && left.channel === right.channel
  && left.originId === right.originId
);

export const closeSampledNote = (
  notes: SampledTimedNote[],
  pitch: number,
  open: SampledOpenNoteState,
  endBeat: number,
  minimumNoteDuration: number,
): void => {
  const orderedStart = Math.max(Math.min(open.startBeat, endBeat), 0);
  const orderedEnd = Math.max(Math.max(open.startBeat, endBeat), 0);
  notes.push({
    pitch,
    channel: open.channel,
    startBeat: orderedStart,
    durationBeats: Math.max(orderedEnd - orderedStart, minimumNoteDuration),
    velocity: open.velocity,
    originId: open.originId,
  });
};

export const collectPitchSampledNotes = ({
  sampleCount,
  endBeat,
  minimumNoteDuration,
  resolveActiveByPitch,
}: CollectPitchSampledNotesOptions): SampledTimedNote[] => {
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) {
    return [];
  }

  const notes: SampledTimedNote[] = [];
  const openByPitch = new Map<number, SampledOpenNoteState>();

  for (let step = 0; step < sampleCount; step += 1) {
    const sampleBeat = step / sampleCount;
    const activeByPitch = resolveActiveByPitch(sampleBeat);

    for (const [pitch, open] of openByPitch.entries()) {
      if (activeByPitch.has(pitch)) {
        continue;
      }

      closeSampledNote(notes, pitch, open, sampleBeat, minimumNoteDuration);
      openByPitch.delete(pitch);
    }

    for (const [pitch, active] of activeByPitch.entries()) {
      const existing = openByPitch.get(pitch);
      if (existing && hasSameNoteState(existing, active)) {
        continue;
      }

      if (existing) {
        closeSampledNote(notes, pitch, existing, sampleBeat, minimumNoteDuration);
      }

      openByPitch.set(pitch, {
        startBeat: sampleBeat,
        velocity: active.velocity,
        channel: active.channel,
        originId: active.originId,
      });
    }
  }

  for (const [pitch, open] of openByPitch.entries()) {
    closeSampledNote(notes, pitch, open, endBeat, minimumNoteDuration);
  }

  return notes;
};
