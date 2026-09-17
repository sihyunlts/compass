import type { ClipNote } from '../shared/model';

interface PlaybackTimeline {
  notes: ReadonlyArray<ClipNote>;
  sourceTimelineEndBeat: number;
  sampleStepBeats: number;
}

export const scalePlaybackTiming = <T extends PlaybackTimeline>(
  timeline: T,
  loopLengthBeats: number,
): T => {
  if (timeline.sourceTimelineEndBeat === loopLengthBeats) {
    return timeline;
  }
  const ratio = loopLengthBeats / timeline.sourceTimelineEndBeat;
  return {
    ...timeline,
    notes: timeline.notes.map((note) => ({
      ...note,
      startBeat: note.startBeat * ratio,
      durationBeats: note.durationBeats * ratio,
    })),
    sourceTimelineEndBeat: loopLengthBeats,
    sampleStepBeats: timeline.sampleStepBeats * ratio,
  };
};
