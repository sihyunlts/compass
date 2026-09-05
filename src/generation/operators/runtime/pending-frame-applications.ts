import {
  type PendingFrameApplication,
  type PendingGeometryRewriteApplication,
  type GenerationState,
  type PendingStrokeRewriteFrameWrite,
} from '../../timeline/state';
import {
  addStrokeToFrame,
  beginTimelineStage,
  completeTimelineStage,
  removeOriginStrokes,
  type FrameWindow,
} from '../../timeline';
import type { CanonicalOutputAdapter } from '../../types';
import {
  buildSourceStrokesByOriginAndFrame,
} from './timeline-strokes';
import {
  applyTimelineStateOverrides,
  buildTimelineStateByOriginId,
  type OriginTimelineStateOverride,
} from './timeline-state';
import type { GeometryStroke, GeometryTimeline } from '../../types';
import { transitionGenerationState } from './state-transition';

const appendPendingFrameApplication = (
  state: GenerationState,
  application: PendingFrameApplication,
  timelineStateOverrides?: ReadonlyMap<string, OriginTimelineStateOverride>,
): GenerationState => {
  return transitionGenerationState(state, {
    pendingFrameApplications: application.targetOriginIds.size > 0
      ? [...state.pendingFrameApplications, application]
      : state.pendingFrameApplications,
    timelineStateByOriginId: timelineStateOverrides
      ? applyTimelineStateOverrides(state.timelineStateByOriginId, timelineStateOverrides)
      : state.timelineStateByOriginId,
  });
};

export const appendPendingStrokeRewriteApplication = (
  state: GenerationState,
  sourceTimeline: GeometryTimeline,
  targetOriginIds: ReadonlySet<string>,
  writes: ReadonlyArray<PendingStrokeRewriteFrameWrite>,
  timelineStateOverrides?: ReadonlyMap<string, OriginTimelineStateOverride>,
): GenerationState => {
  return appendPendingFrameApplication(
    state,
    {
      kind: 'stroke-rewrite',
      targetOriginIds: new Set(targetOriginIds),
      sourceFrameCount: sourceTimeline.frames.length,
      endBeat: sourceTimeline.timeDomainEndBeat,
      writes,
    },
    timelineStateOverrides,
  );
};

export const appendPendingGeometryRewriteApplication = (
  state: GenerationState,
  targetOriginIds: ReadonlySet<string>,
  rewriteFrameStrokes: PendingGeometryRewriteApplication['rewriteFrameStrokes'],
  timelineStateOverrides?: ReadonlyMap<string, OriginTimelineStateOverride>,
): GenerationState => {
  return appendPendingFrameApplication(
    state,
    {
      kind: 'geometry-rewrite',
      targetOriginIds: new Set(targetOriginIds),
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
  const originIds = Array.from(targetOriginIds);

  for (
    let frameIndex = frameWindow.startFrame;
    frameIndex < frameWindow.endFrameExclusive;
    frameIndex += 1
  ) {
    const sourceStrokes = originIds.flatMap((originId) => (
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
  removeOriginStrokes(
    nextTimeline,
    plan.targetOriginIds,
    Math.min(plan.sourceFrameCount, nextTimeline.frames.length),
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
  const originIds = Array.from(application.targetOriginIds);
  return materializeTargetOriginFrameRewrite(
    timeline,
    {
      targetOriginIds: application.targetOriginIds,
      sourceFrameCount: timeline.frames.length,
      endBeat: timeline.timeDomainEndBeat,
    },
    (nextTimeline) => {
      for (
        let frameIndex = 0;
        frameIndex < timeline.frames.length;
        frameIndex += 1
      ) {
        const sourceStrokes = originIds.flatMap((originId) => (
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
  state: GenerationState,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): GenerationState => {
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
