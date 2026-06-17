import type { SceneTemporalState } from '../../../core/core-types';
import { evaluateTemporalRemap } from '../../../core/scene-operators/temporal';
import {
  buildColorTimingSegmentsByOriginId,
  planColorProgram,
  type ColorProgramSlot,
  type ColorTimingSample,
} from '../../../devices/color/color-program';
import type {
  PendingColorApplication,
  PendingTemporalMaterializationCheckpoint,
} from '../../timeline/state';
import {
  addStrokeToFrames,
  toFrameCount,
  toFrameWindow,
  type FrameWindow,
} from '../../timeline';
import type {
  GeometrySample,
  GeometryStroke,
  GeometryTimingSample,
  GeometryTimeline,
} from '../../types';
import {
  FIXED_TIMELINE_END_BEAT,
  type TimelineWindow,
} from '../../timeline/temporal-window';
import { isFrameWithinWindow, resolveFrameWindow } from './frame-window';
import {
  cloneStrokeWithVelocityAndWriteOrder,
  resolveColorSlotDestinationFrameIndexes,
  resolveColorSlotWriteOrder,
} from './timeline-strokes';
import {
  resolveWindowSampleBeatForFrame,
} from './temporal-frame-sampling';

type PendingColorProgramApplication = Omit<PendingColorApplication, 'precedingTemporalCheckpoint'>;

type ColorMaterializationStage = Parameters<typeof addStrokeToFrames>[0];

interface ColorGeometrySample {
  beat: number;
  strokes: ReadonlyArray<GeometryStroke>;
}

const resolveSampleIndex = (
  beat: number,
  sampleStepBeats: number,
  frameCount: number,
): number => Math.min(
  Math.max(Math.floor(beat / sampleStepBeats), 0),
  Math.max(frameCount - 1, 0),
);

const buildSampleByIndex = <TSample extends { beat: number }>(
  samples: ReadonlyArray<TSample>,
  sampleStepBeats: number,
  frameCount: number,
): Map<number, TSample> => new Map(
  samples.map((sample) => [
    resolveSampleIndex(sample.beat, sampleStepBeats, frameCount),
    sample,
  ]),
);

const resolveTemporalSourceSampleIndex = (
  temporal: SceneTemporalState,
  outputFrameIndex: number,
  outputFrameCount: number,
  sampleStepBeats: number,
  sourceFrameCount: number,
): number | null => {
  const frameWindow = toFrameWindow(
    temporal.visibilityWindow,
    sampleStepBeats,
    outputFrameCount,
  );
  if (
    outputFrameIndex < frameWindow.startFrame
    || outputFrameIndex >= frameWindow.endFrameExclusive
  ) {
    return null;
  }

  const outputBeat = resolveWindowSampleBeatForFrame(
    outputFrameIndex,
    frameWindow,
    temporal.visibilityWindow,
  );
  const sourceBeat = evaluateTemporalRemap(temporal.remap, outputBeat);
  if (sourceBeat === null || !Number.isFinite(sourceBeat)) {
    return null;
  }

  return resolveSampleIndex(sourceBeat, sampleStepBeats, sourceFrameCount);
};

interface ColorTemporalSampleRemapContext {
  temporal: SceneTemporalState;
  sampleStepBeats: number;
  sourceFrameCount: number;
}

const remapColorSamples = <TSourceSample extends { beat: number }, TRemappedSample>(
  samples: ReadonlyArray<TSourceSample>,
  context: ColorTemporalSampleRemapContext,
  mapSample: (
    sample: TSourceSample,
    outputBeat: number,
    outputFrameIndex: number,
  ) => TRemappedSample,
): TRemappedSample[] => {
  const sampleByIndex = buildSampleByIndex(
    samples,
    context.sampleStepBeats,
    context.sourceFrameCount,
  );
  const outputFrameCount = toFrameCount(FIXED_TIMELINE_END_BEAT, context.sampleStepBeats);
  const remappedSamples: TRemappedSample[] = [];

  for (let outputFrameIndex = 0; outputFrameIndex < outputFrameCount; outputFrameIndex += 1) {
    const outputBeat = outputFrameIndex * context.sampleStepBeats;
    const sourceSampleIndex = resolveTemporalSourceSampleIndex(
      context.temporal,
      outputFrameIndex,
      outputFrameCount,
      context.sampleStepBeats,
      context.sourceFrameCount,
    );
    if (sourceSampleIndex === null) {
      continue;
    }

    const sample = sampleByIndex.get(sourceSampleIndex);
    if (!sample) {
      continue;
    }

    remappedSamples.push(mapSample(sample, outputBeat, outputFrameIndex));
  }

  return remappedSamples;
};

const remapColorGeometrySamples = (
  samples: ReadonlyArray<GeometrySample>,
  temporal: SceneTemporalState,
  sampleStepBeats: number,
  sourceFrameCount: number,
): ColorGeometrySample[] => remapColorSamples(
  samples,
  {
    temporal,
    sampleStepBeats,
    sourceFrameCount,
  },
  (sample, outputBeat) => ({
    beat: outputBeat,
    strokes: sample.strokes,
  }),
);

const buildColorGeometrySource = (
  timeline: GeometryTimeline,
  targetOriginIds: ReadonlySet<string>,
  precedingTemporalCheckpoint: PendingTemporalMaterializationCheckpoint | null,
): ColorGeometrySource => {
  const samplesByOriginId = new Map<string, ReadonlyArray<ColorGeometrySample>>();
  const sourceFrameCount = toFrameCount(timeline.timeDomainEndBeat, timeline.sampleStepBeats);

  for (const originId of targetOriginIds) {
    const samples = timeline.geometrySamplesByOriginId.get(originId);
    if (!samples || samples.length === 0) {
      continue;
    }

    const temporal = precedingTemporalCheckpoint?.temporalByOriginId.get(originId);
    samplesByOriginId.set(
      originId,
      temporal
        ? remapColorGeometrySamples(samples, temporal, timeline.sampleStepBeats, sourceFrameCount)
        : [...samples].sort((left, right) => left.beat - right.beat),
    );
  }

  return {
    samplesByOriginId,
  };
};

const remapColorTimingSamples = (
  samples: ReadonlyArray<GeometryTimingSample>,
  temporal: SceneTemporalState,
  sampleStepBeats: number,
  sourceFrameCount: number,
): ColorTimingSample[] => remapColorSamples(
  samples,
  {
    temporal,
    sampleStepBeats,
    sourceFrameCount,
  },
  (sample, outputBeat, outputFrameIndex) => ({
    beat: outputBeat,
    strokes: sample.strokes.map((stroke) => ({
      ...stroke,
      id: `${stroke.id}@${outputFrameIndex}`,
    })),
  }),
);

const buildColorTimingSamplesForOrigins = (
  timeline: GeometryTimeline,
  targetOriginIds: ReadonlySet<string>,
  precedingTemporalCheckpoint: PendingTemporalMaterializationCheckpoint | null,
): Map<string, ColorTimingSample[]> => {
  const samplesByOriginId = new Map<string, ColorTimingSample[]>();
  const sourceFrameCount = toFrameCount(timeline.timeDomainEndBeat, timeline.sampleStepBeats);

  for (const originId of targetOriginIds) {
    const samples = timeline.timingSamplesByOriginId.get(originId);
    if (!samples || samples.length === 0) {
      continue;
    }

    const temporal = precedingTemporalCheckpoint?.temporalByOriginId.get(originId);
    samplesByOriginId.set(
      originId,
      temporal
        ? remapColorTimingSamples(samples, temporal, timeline.sampleStepBeats, sourceFrameCount)
        : samples.map((sample) => ({
            beat: sample.beat,
            strokes: sample.strokes.map((stroke) => ({ ...stroke })),
          })),
    );
  }

  return samplesByOriginId;
};

interface ColorMaterializationSource {
  geometry: ColorGeometrySource;
  timing: ColorTimingSource;
}

interface ColorGeometrySource {
  samplesByOriginId: ReadonlyMap<string, ReadonlyArray<ColorGeometrySample>>;
}

interface ColorTimingSource {
  samplesByOriginId: Map<string, ColorTimingSample[]>;
  timeDomainEndBeat: number;
}

const buildColorTimingSource = (
  timeline: GeometryTimeline,
  targetOriginIds: ReadonlySet<string>,
  precedingTemporalCheckpoint: PendingTemporalMaterializationCheckpoint | null,
): ColorTimingSource => ({
  samplesByOriginId: buildColorTimingSamplesForOrigins(
    timeline,
    targetOriginIds,
    precedingTemporalCheckpoint,
  ),
  timeDomainEndBeat: timeline.timeDomainEndBeat,
});

const buildColorMaterializationSource = (
  timeline: GeometryTimeline,
  targetOriginIds: ReadonlySet<string>,
  precedingTemporalCheckpoint: PendingTemporalMaterializationCheckpoint | null,
): ColorMaterializationSource => ({
  geometry: buildColorGeometrySource(timeline, targetOriginIds, precedingTemporalCheckpoint),
  timing: buildColorTimingSource(timeline, targetOriginIds, precedingTemporalCheckpoint),
});

const resolveColorSlotDestinationFrameWindow = (
  slot: ColorProgramSlot,
  sampleStepBeats: number,
  frameCount: number,
): FrameWindow => {
  if (slot.source.referenceDuration === undefined) {
    return toFrameWindow(
      {
        start: slot.startBeat,
        end: slot.endBeat,
      },
      sampleStepBeats,
      frameCount,
    );
  }

  const segmentDuration = slot.endBeat - slot.startBeat;
  const extraDuration = Math.max(segmentDuration - slot.source.referenceDuration, 0);
  return toFrameWindow(
    {
      start: slot.startBeat,
      end: slot.startBeat + sampleStepBeats + extraDuration,
    },
    sampleStepBeats,
    frameCount,
  );
};

const resolveColorDestinationFrameIndex = (
  slotStartBeat: number,
  sampleStepBeats: number,
): number => Math.round(
  slotStartBeat / sampleStepBeats,
);

const resolveColorProgramDestinationFrameIndexes = (
  slot: ColorProgramSlot,
  sourceBeat: number,
  destinationFrameWindow: FrameWindow,
  timelineFrameCount: number,
  sampleStepBeats: number,
): number[] => {
  if (slot.destinationMode === 'source-frame') {
    return [Math.round(sourceBeat / sampleStepBeats)];
  }

  const destinationFrameIndex = resolveColorDestinationFrameIndex(
    slot.startBeat,
    sampleStepBeats,
  );
  return resolveColorSlotDestinationFrameIndexes(
    slot.source,
    destinationFrameIndex,
    destinationFrameWindow,
    timelineFrameCount,
    slot.shouldWrap,
  );
};

const resolveColorProgramVisibleDestinationFrameIndexes = (
  slot: ColorProgramSlot,
  sourceBeat: number,
  destinationFrameWindow: FrameWindow,
  colorFrameWindow: FrameWindow,
  timelineFrameCount: number,
  sampleStepBeats: number,
): number[] => resolveColorProgramDestinationFrameIndexes(
  slot,
  sourceBeat,
  destinationFrameWindow,
  timelineFrameCount,
  sampleStepBeats,
).filter((resolvedDestinationFrameIndex) => (
  isFrameWithinWindow(resolvedDestinationFrameIndex, colorFrameWindow)
  && (
    slot.shouldWrap
    || slot.destinationMode === 'source-frame'
    || (
      resolvedDestinationFrameIndex >= destinationFrameWindow.startFrame
      && resolvedDestinationFrameIndex < destinationFrameWindow.endFrameExclusive
    )
  )
));

const cloneColorSlotStrokeWithVelocity = (
  stroke: GeometryStroke,
  slot: ColorProgramSlot,
  application: PendingColorProgramApplication,
): Omit<GeometryStroke, 'writeId'> => {
  const colorSlotCount = application.colorConfig.velocities.length;
  return cloneStrokeWithVelocityAndWriteOrder(
    stroke,
    slot.velocity,
    slot.colorSlotGapFill
      ? resolveColorSlotWriteOrder(application.writeOrder, slot.slotIndex, colorSlotCount)
      : application.writeOrder,
    slot.slotIndex,
    colorSlotCount,
    slot.colorSlotGapFill,
  );
};

interface ColorSlotFrameWindows {
  destinationFrameWindow: FrameWindow;
  visibleFrameWindow: FrameWindow;
}

interface ColorSlotFrameCandidate {
  slot: ColorProgramSlot;
  destinationFrameIndex: number;
  overlapBeats: number;
  distanceToFrameCenter: number;
}

const COLOR_SLOT_OVERLAP_EPSILON = 1e-9;

const resolveColorSlotFrameWindows = (
  slot: ColorProgramSlot,
  sampleStepBeats: number,
  frameWindow: FrameWindow,
  outputFrameCount: number,
): ColorSlotFrameWindows => ({
  destinationFrameWindow: resolveColorSlotDestinationFrameWindow(
    slot,
    sampleStepBeats,
    outputFrameCount,
  ),
  visibleFrameWindow: slot.useExtendedFrameWindow
    ? resolveFrameWindow('all', sampleStepBeats, outputFrameCount)
    : frameWindow,
});

interface PendingColorProgramMaterializationPlan {
  slotsByOriginId: Map<string, ColorProgramSlot[]>;
  colorTimelineEndBeat: number;
  playbackWindowByOriginId: Map<string, TimelineWindow>;
}

const buildColorProgramMaterializationPlanFromTiming = (
  source: ColorTimingSource,
  sampleStepBeats: number,
  application: PendingColorProgramApplication,
): PendingColorProgramMaterializationPlan => {
  const targetSegmentsByOriginId = buildColorTimingSegmentsByOriginId(
    source.samplesByOriginId,
    sampleStepBeats,
  );
  const colorProgram = planColorProgram(
    targetSegmentsByOriginId,
    application.colorConfig,
    sampleStepBeats,
    source.timeDomainEndBeat,
  );

  return {
    slotsByOriginId: colorProgram.slotsByOriginId,
    colorTimelineEndBeat: colorProgram.endBeat,
    playbackWindowByOriginId: colorProgram.playbackWindowByOriginId,
  };
};

interface PendingColorMaterialization {
  frameWindow: FrameWindow;
  geometry: ColorGeometrySource;
  outputFrameCount: number;
  plan: PendingColorProgramMaterializationPlan;
}

export const buildPendingColorMaterialization = (
  timeline: GeometryTimeline,
  application: PendingColorProgramApplication,
  precedingTemporalCheckpoint: PendingTemporalMaterializationCheckpoint | null = null,
): PendingColorMaterialization => {
  const source = buildColorMaterializationSource(
    timeline,
    application.targetOriginIds,
    precedingTemporalCheckpoint,
  );
  const plan = buildColorProgramMaterializationPlanFromTiming(
    source.timing,
    timeline.sampleStepBeats,
    application,
  );
  const timelineFrameCount = toFrameCount(
    timeline.timeDomainEndBeat,
    timeline.sampleStepBeats,
  );

  return {
    frameWindow: resolveFrameWindow(
      application.requiredFrameWindow,
      timeline.sampleStepBeats,
      timelineFrameCount,
    ),
    geometry: source.geometry,
    outputFrameCount: toFrameCount(plan.colorTimelineEndBeat, timeline.sampleStepBeats),
    plan,
  };
};

const buildPendingColorProgramMaterializationPlan = (
  timeline: GeometryTimeline,
  application: PendingColorProgramApplication,
  precedingTemporalCheckpoint: PendingTemporalMaterializationCheckpoint | null = null,
): PendingColorProgramMaterializationPlan => buildColorProgramMaterializationPlanFromTiming(
  buildColorTimingSource(
    timeline,
    application.targetOriginIds,
    precedingTemporalCheckpoint,
  ),
  timeline.sampleStepBeats,
  application,
);

const resolveFrameSlotOverlapBeats = (
  slot: ColorProgramSlot,
  frameIndex: number,
  sampleStepBeats: number,
): number => {
  const frameStartBeat = frameIndex * sampleStepBeats;
  const frameEndBeat = frameStartBeat + sampleStepBeats;
  return Math.max(
    Math.min(frameEndBeat, slot.endBeat) - Math.max(frameStartBeat, slot.startBeat),
    0,
  );
};

const resolveDistanceToFrameCenter = (
  slot: ColorProgramSlot,
  frameIndex: number,
  sampleStepBeats: number,
): number => {
  const frameCenterBeat = (frameIndex + 0.5) * sampleStepBeats;
  const slotCenterBeat = (slot.startBeat + slot.endBeat) / 2;
  return Math.abs(frameCenterBeat - slotCenterBeat);
};

const shouldReplaceColorSlotFrameCandidate = (
  candidate: ColorSlotFrameCandidate,
  current: ColorSlotFrameCandidate,
): boolean => {
  const overlapDelta = candidate.overlapBeats - current.overlapBeats;
  if (Math.abs(overlapDelta) > COLOR_SLOT_OVERLAP_EPSILON) {
    return overlapDelta > 0;
  }

  const distanceDelta = candidate.distanceToFrameCenter - current.distanceToFrameCenter;
  if (Math.abs(distanceDelta) > COLOR_SLOT_OVERLAP_EPSILON) {
    return distanceDelta < 0;
  }

  return candidate.slot.startBeat < current.slot.startBeat;
};

const addColorSlotFrameCandidate = (
  candidatesByFrameIndex: Map<number, ColorSlotFrameCandidate>,
  slot: ColorProgramSlot,
  destinationFrameIndex: number,
  sampleStepBeats: number,
): void => {
  const candidate: ColorSlotFrameCandidate = {
    slot,
    destinationFrameIndex,
    overlapBeats: resolveFrameSlotOverlapBeats(
      slot,
      destinationFrameIndex,
      sampleStepBeats,
    ),
    distanceToFrameCenter: resolveDistanceToFrameCenter(
      slot,
      destinationFrameIndex,
      sampleStepBeats,
    ),
  };
  const current = candidatesByFrameIndex.get(destinationFrameIndex);
  if (!current || shouldReplaceColorSlotFrameCandidate(candidate, current)) {
    candidatesByFrameIndex.set(destinationFrameIndex, candidate);
  }
};

const writeColorSlotSampleToStage = (
  timelineStage: ColorMaterializationStage,
  application: PendingColorProgramApplication,
  candidate: ColorSlotFrameCandidate,
  sourceSample: ColorGeometrySample,
): void => {
  if (sourceSample.strokes.length === 0) {
    return;
  }

  for (const stroke of sourceSample.strokes) {
    const colorStroke = cloneColorSlotStrokeWithVelocity(
      stroke,
      candidate.slot,
      application,
    );

    addStrokeToFrames(
      timelineStage,
      [candidate.destinationFrameIndex],
      colorStroke,
    );
  }
};

const sampleColorProgramSourceSampleIntoStage = (
  timelineStage: ColorMaterializationStage,
  sampleStepBeats: number,
  application: PendingColorProgramApplication,
  slots: ReadonlyArray<ColorProgramSlot>,
  sourceSample: ColorGeometrySample,
  frameWindow: FrameWindow,
  outputFrameCount: number,
): void => {
  if (sourceSample.strokes.length === 0) {
    return;
  }

  const candidatesByFrameIndex = new Map<number, ColorSlotFrameCandidate>();
  for (const slot of slots) {
    if (sourceSample.beat < slot.sourceStartBeat) {
      break;
    }
    if (sourceSample.beat >= slot.sourceEndBeat) {
      continue;
    }

    const frameWindows = resolveColorSlotFrameWindows(
      slot,
      sampleStepBeats,
      frameWindow,
      outputFrameCount,
    );
    const resolvedDestinationFrameIndexes = resolveColorProgramVisibleDestinationFrameIndexes(
      slot,
      sourceSample.beat,
      frameWindows.destinationFrameWindow,
      frameWindows.visibleFrameWindow,
      outputFrameCount,
      sampleStepBeats,
    );

    for (const destinationFrameIndex of resolvedDestinationFrameIndexes) {
      addColorSlotFrameCandidate(
        candidatesByFrameIndex,
        slot,
        destinationFrameIndex,
        sampleStepBeats,
      );
    }
  }

  for (const candidate of candidatesByFrameIndex.values()) {
    writeColorSlotSampleToStage(
      timelineStage,
      application,
      candidate,
      sourceSample,
    );
  }
};

export const sampleColorProgramSlotsIntoStage = (
  timelineStage: ColorMaterializationStage,
  sampleStepBeats: number,
  application: PendingColorProgramApplication,
  plan: PendingColorProgramMaterializationPlan,
  geometry: ColorGeometrySource,
  frameWindow: FrameWindow,
  outputFrameCount: number,
): void => {
  for (const [originId, slots] of plan.slotsByOriginId.entries()) {
    const sourceSamples = geometry.samplesByOriginId.get(originId);
    if (!sourceSamples || sourceSamples.length === 0 || slots.length === 0) {
      continue;
    }

    for (const sourceSample of sourceSamples) {
      sampleColorProgramSourceSampleIntoStage(
        timelineStage,
        sampleStepBeats,
        application,
        slots,
        sourceSample,
        frameWindow,
        outputFrameCount,
      );
    }
  }
};

export const resolvePendingColorPlaybackWindowOverrides = (
  timeline: GeometryTimeline,
  application: PendingColorProgramApplication,
  precedingTemporalCheckpoint: PendingTemporalMaterializationCheckpoint | null = null,
): Map<string, TimelineWindow> => buildPendingColorProgramMaterializationPlan(
  timeline,
  application,
  precedingTemporalCheckpoint,
).playbackWindowByOriginId;
