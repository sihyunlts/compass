import {
  clonePendingFrameApplications,
  type PendingFrameApplication,
  type PendingGeometryRewriteApplication,
  type MutableGenerationState,
  type PendingStrokeRewriteApplication,
  type PendingStrokeRewriteFrameWrite,
} from '../../timeline/state';
import {
  addStrokeToFrame,
  beginTimelineStage,
  completeTimelineStage,
  type FrameWindow,
} from '../../timeline';
import type { CanonicalOutputAdapter } from '../../types';
import {
  buildSourceStrokesByOriginAndFrame,
  stripOriginFrames,
} from './timeline-strokes';
import {
  applyTimelineStateOverrides,
  buildTimelineStateByOriginId,
  type OriginTimelineStateOverride,
} from './timeline-state';
import type { GeometryStroke, GeometryTimeline } from '../../types';
import type { PendingFrameApplicationOperatorInput } from './types';
import { resolveFrameWindow } from './frame-window';
import { transitionGenerationState } from './state-transition';

type PendingFrameApplicationDraft = PendingGeometryRewriteApplication | PendingStrokeRewriteApplication;

type PendingFrameApplicationAppendInput = Pick<
  PendingFrameApplicationOperatorInput,
  'baseState'
>;

const appendPendingFrameApplication = (
  input: PendingFrameApplicationAppendInput,
  application: PendingFrameApplicationDraft,
  timelineStateOverrides?: ReadonlyMap<string, OriginTimelineStateOverride>,
): MutableGenerationState => {
  const state = input.baseState;
  const pendingFrameApplications = clonePendingFrameApplications(state.pendingFrameApplications);
  if (application.targetOriginIds.size > 0) {
    pendingFrameApplications.push(application);
  }

  return transitionGenerationState(state, {
    pendingFrameApplications,
    timelineStateByOriginId: timelineStateOverrides
      ? applyTimelineStateOverrides(state.timelineStateByOriginId, timelineStateOverrides)
      : state.timelineStateByOriginId,
  });
};

export const appendPendingStrokeRewriteApplication = (
  input: PendingFrameApplicationOperatorInput,
  targetOriginIds: ReadonlySet<string>,
  writes: ReadonlyArray<PendingStrokeRewriteFrameWrite>,
  timelineStateOverrides?: ReadonlyMap<string, OriginTimelineStateOverride>,
): MutableGenerationState => {
  return appendPendingFrameApplication(
    input,
    {
      kind: 'stroke-rewrite',
      targetOriginIds: new Set(targetOriginIds),
      sourceFrameCount: input.sourceState.timeline.frames.length,
      endBeat: input.sourceState.timeline.timeDomainEndBeat,
      writes,
    },
    timelineStateOverrides,
  );
};

export const appendPendingGeometryRewriteApplication = (
  input: PendingFrameApplicationAppendInput,
  targetOriginIds: ReadonlySet<string>,
  requiredFrameWindow: PendingGeometryRewriteApplication['requiredFrameWindow'],
  rewriteFrameStrokes: PendingGeometryRewriteApplication['rewriteFrameStrokes'],
  timelineStateOverrides?: ReadonlyMap<string, OriginTimelineStateOverride>,
): MutableGenerationState => {
  return appendPendingFrameApplication(
    input,
    {
      kind: 'geometry-rewrite',
      targetOriginIds: new Set(targetOriginIds),
      requiredFrameWindow,
      rewriteFrameStrokes,
    },
    timelineStateOverrides,
  );
};

export const buildPendingStrokeRewriteFrameWrites = (
  timeline: GeometryTimeline,
  targetOriginIds: ReadonlySet<string>,
  frameWindow: FrameWindow,
  rewriteFrameStrokes: (
    frameIndex: number,
    strokes: ReadonlyArray<GeometryStroke>,
  ) => ReadonlyArray<Omit<GeometryStroke, 'writeId'>>,
): PendingStrokeRewriteFrameWrite[] => {
  const sourceStrokesByOriginAndFrame = buildSourceStrokesByOriginAndFrame(
    timeline,
    targetOriginIds,
  );
  const writes: PendingStrokeRewriteFrameWrite[] = [];

  for (
    let frameIndex = frameWindow.startFrame;
    frameIndex < frameWindow.endFrameExclusive;
    frameIndex += 1
  ) {
    const sourceStrokes = Array.from(targetOriginIds).flatMap((originId) => (
      sourceStrokesByOriginAndFrame.get(originId)?.get(frameIndex) ?? []
    ));
    if (sourceStrokes.length === 0) {
      continue;
    }

    const strokes = rewriteFrameStrokes(frameIndex, sourceStrokes);
    if (strokes.length === 0) {
      continue;
    }

    writes.push({
      destinationFrameIndex: frameIndex,
      strokes,
    });
  }

  return writes;
};

type PendingFrameRewriteStage = ReturnType<typeof beginTimelineStage>;

interface PendingFrameRewritePlan {
  targetOriginIds: ReadonlySet<string>;
  sourceFrameCount: number;
  endBeat: number;
}

const isFrameIndexWithinTimeline = (
  timeline: GeometryTimeline,
  frameIndex: number,
): boolean => frameIndex >= 0 && frameIndex < timeline.frames.length;

const materializeTargetOriginFrameRewrite = (
  timeline: GeometryTimeline,
  plan: PendingFrameRewritePlan,
  applyWrites: (timeline: PendingFrameRewriteStage) => void,
): GeometryTimeline => {
  const nextTimeline = beginTimelineStage(
    timeline,
    Math.max(timeline.timeDomainEndBeat, plan.endBeat),
  );
  stripOriginFrames(
    nextTimeline,
    Math.min(plan.sourceFrameCount, nextTimeline.frames.length),
    plan.targetOriginIds,
  );

  applyWrites(nextTimeline);

  return completeTimelineStage(nextTimeline);
};

const materializePendingStrokeRewriteApplication = (
  timeline: GeometryTimeline,
  application: Extract<PendingFrameApplication, { kind: 'stroke-rewrite' }>,
): GeometryTimeline => materializeTargetOriginFrameRewrite(timeline, application, (nextTimeline) => {
  for (const write of application.writes) {
    if (!isFrameIndexWithinTimeline(nextTimeline, write.destinationFrameIndex)) {
      continue;
    }

    for (const stroke of write.strokes) {
      addStrokeToFrame(nextTimeline, write.destinationFrameIndex, stroke);
    }
  }
});

const materializePendingGeometryRewriteApplication = (
  timeline: GeometryTimeline,
  application: Extract<PendingFrameApplication, { kind: 'geometry-rewrite' }>,
): GeometryTimeline => {
  const sourceStrokesByOriginAndFrame = buildSourceStrokesByOriginAndFrame(
    timeline,
    application.targetOriginIds,
  );
  const frameWindow = resolveFrameWindow(
    application.requiredFrameWindow,
    timeline.sampleStepBeats,
    timeline.frames.length,
  );

  return materializeTargetOriginFrameRewrite(
    timeline,
    {
      targetOriginIds: application.targetOriginIds,
      sourceFrameCount: timeline.frames.length,
      endBeat: timeline.timeDomainEndBeat,
    },
    (nextTimeline) => {
      for (
        let frameIndex = frameWindow.startFrame;
        frameIndex < frameWindow.endFrameExclusive;
        frameIndex += 1
      ) {
        const sourceStrokes = Array.from(application.targetOriginIds).flatMap((originId) => (
          sourceStrokesByOriginAndFrame.get(originId)?.get(frameIndex) ?? []
        ));
        if (sourceStrokes.length === 0) {
          continue;
        }

        const rewrittenStrokes = application.rewriteFrameStrokes({
          timeline,
          frameIndex,
          strokes: sourceStrokes,
        });
        for (const stroke of rewrittenStrokes) {
          addStrokeToFrame(nextTimeline, frameIndex, stroke);
        }
      }
    },
  );
};

const materializePendingFrameApplication = (
  timeline: GeometryTimeline,
  application: PendingFrameApplication,
): GeometryTimeline => {
  switch (application.kind) {
    case 'geometry-rewrite': {
      return materializePendingGeometryRewriteApplication(timeline, application);
    }
    case 'stroke-rewrite': {
      return materializePendingStrokeRewriteApplication(timeline, application);
    }
  }
};

export const materializePendingFrameApplications = (
  state: MutableGenerationState,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  if (state.pendingFrameApplications.length === 0) {
    return state;
  }

  let timeline = state.timeline;
  for (const application of state.pendingFrameApplications) {
    timeline = materializePendingFrameApplication(timeline, application);
  }

  return transitionGenerationState(state, {
    timeline,
    timelineStateByOriginId: buildTimelineStateByOriginId(
      timeline,
      state.timelineStateByOriginId,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    ),
    pendingFrameApplications: [],
  });
};
