import type { SceneTemporalState } from '../../../core/core-types';
import {
  evaluateTemporalRemap,
} from '../../../core/scene-operators/temporal';
import {
  createMaterializedTemporalState,
  type TimelineWindow,
} from '../../timeline/temporal-window';
import { toFrameCount } from '../../timeline';
import type { GeometryTimeline } from '../../types';
import type { OriginFrameRemap } from './types';
import {
  resolveTimelineWindowFrameWindow,
  resolveWindowSampleBeatForFrame,
} from './temporal-frame-sampling';
import { toSourceFrameIndex } from './timeline-strokes';

type SourceWindowFrameAlignment = 'start' | 'end';

const buildOutputFrameIndexes = (
  timeline: GeometryTimeline,
  outputEndBeat: number,
  resolveSourceFrameIndex: (outputBeat: number) => number | null,
): Array<number | null> => Array.from(
  { length: toFrameCount(outputEndBeat, timeline.sampleStepBeats) },
  (_, frameIndex) => resolveSourceFrameIndex(frameIndex * timeline.sampleStepBeats),
);

const buildSourceWindowFrameIndexes = (
  timeline: GeometryTimeline,
  outputEndBeat: number,
  sourceWindow: TimelineWindow,
  alignment: SourceWindowFrameAlignment,
): Array<number | null> | null => {
  const sourceSpan = sourceWindow.end - sourceWindow.start;
  if (!Number.isFinite(sourceSpan) || sourceSpan <= 0 || !Number.isFinite(outputEndBeat) || outputEndBeat <= 0) {
    return null;
  }

  const outputFrameCount = toFrameCount(outputEndBeat, timeline.sampleStepBeats);
  if (alignment === 'end') {
    const sourceEndFrameIndex = toSourceFrameIndex(sourceWindow.end, timeline);
    const sourceFrameSpan = sourceSpan / timeline.sampleStepBeats;
    return Array.from({ length: outputFrameCount }, (_, frameIndex) => {
      const mirroredOutputFrameIndex = outputFrameCount - 1 - frameIndex;
      return Math.min(
        Math.max(
          sourceEndFrameIndex - Math.floor((sourceFrameSpan * mirroredOutputFrameIndex) / outputFrameCount),
          0,
        ),
        Math.max(timeline.frames.length - 1, 0),
      );
    });
  }

  return buildOutputFrameIndexes(timeline, outputEndBeat, (outputBeat) => {
    const normalized = outputBeat / outputEndBeat;
    return toSourceFrameIndex(
      sourceWindow.start + sourceSpan * normalized,
      timeline,
    );
  });
};

const buildTemporalFrameIndexes = (
  timeline: GeometryTimeline,
  outputEndBeat: number,
  temporal: SceneTemporalState,
): Array<number | null> => {
  const placementWindow = temporal.visibilityWindow;
  const placementSpan = placementWindow.end - placementWindow.start;
  if (!Number.isFinite(placementSpan) || placementSpan <= 0) {
    return buildOutputFrameIndexes(timeline, outputEndBeat, () => null);
  }

  const outputFrameCount = toFrameCount(outputEndBeat, timeline.sampleStepBeats);
  const placementFrameWindow = resolveTimelineWindowFrameWindow(
    timeline,
    outputFrameCount,
    placementWindow,
  );

  return Array.from({ length: outputFrameCount }, (_, frameIndex) => {
    if (
      frameIndex < placementFrameWindow.startFrame
      || frameIndex >= placementFrameWindow.endFrameExclusive
    ) {
      return null;
    }

    const outputBeat = resolveWindowSampleBeatForFrame(
      frameIndex,
      placementFrameWindow,
      placementWindow,
    );
    const sourceBeat = evaluateTemporalRemap(temporal.remap, outputBeat);
    if (sourceBeat === null || !Number.isFinite(sourceBeat)) {
      return null;
    }

    return toSourceFrameIndex(sourceBeat, timeline);
  });
};

export const buildSourceWindowOriginFrameRemap = (
  timeline: GeometryTimeline,
  outputEndBeat: number,
  sourceWindow: TimelineWindow,
  nextTemporal: SceneTemporalState,
  writeOrder: number,
  alignment: SourceWindowFrameAlignment = 'start',
): OriginFrameRemap | null => {
  const sourceFrameIndexByOutputFrame = buildSourceWindowFrameIndexes(
    timeline,
    outputEndBeat,
    sourceWindow,
    alignment,
  );
  if (!sourceFrameIndexByOutputFrame) {
    return null;
  }

  return {
    nextTemporal,
    sourceFrameIndexByOutputFrame,
    writeOrder,
  };
};

export const buildTemporalOriginFrameRemap = (
  timeline: GeometryTimeline,
  outputEndBeat: number,
  temporal: SceneTemporalState,
  writeOrder: number,
): OriginFrameRemap => ({
  nextTemporal: createMaterializedTemporalState(temporal.visibilityWindow),
  sourceFrameIndexByOutputFrame: buildTemporalFrameIndexes(timeline, outputEndBeat, temporal),
  writeOrder,
});
