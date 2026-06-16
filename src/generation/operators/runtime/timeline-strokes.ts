import type { AffineTransform } from '../../../core/core-types';
import {
  applyTransformToPolyline,
  composeAffine,
  invertAffine,
} from '../../../core/geometry';
import type { TimedColorSource } from '../../../devices/color/color-program';
import {
  collectOccupiedCoordinates,
} from '../../timeline/analysis';
import {
  addStrokeToFrame,
  setFrameStrokes,
  type FrameWindow,
} from '../../timeline';
import type {
  GeometryMask,
  GeometryStroke,
  GeometryTimeline,
} from '../../types';
import { isFrameWithinWindow } from './frame-window';

const wrapFrameIndex = (
  frameIndex: number,
  frameCount: number,
): number => {
  const safeFrameCount = Math.max(frameCount, 1);
  return ((frameIndex % safeFrameCount) + safeFrameCount) % safeFrameCount;
};

const isTargetedStroke = (
  stroke: GeometryStroke,
  targetGroupId: string | null,
): boolean => targetGroupId === null || stroke.originGroupId === targetGroupId;

const splitFrameStrokesByTarget = (
  strokes: ReadonlyArray<GeometryStroke>,
  targetGroupId: string | null,
): {
  targeted: GeometryStroke[];
  untargeted: GeometryStroke[];
} => {
  const targeted: GeometryStroke[] = [];
  const untargeted: GeometryStroke[] = [];

  for (const stroke of strokes) {
    if (isTargetedStroke(stroke, targetGroupId)) {
      targeted.push(stroke);
    } else {
      untargeted.push(stroke);
    }
  }

  return {
    targeted,
    untargeted,
  };
};

const takeTargetedStrokesFromFrame = (
  timeline: GeometryTimeline,
  frameIndex: number,
  targetGroupId: string | null,
): GeometryStroke[] => {
  const { targeted, untargeted } = splitFrameStrokesByTarget(
    timeline.frames[frameIndex]?.strokes ?? [],
    targetGroupId,
  );

  if (targeted.length > 0) {
    setFrameStrokes(timeline, frameIndex, untargeted);
  }

  return targeted;
};

export const forEachTargetedFrame = (
  timeline: GeometryTimeline,
  sourceFrameCount: number,
  targetGroupId: string | null,
  frameWindow: FrameWindow,
  visit: (frameIndex: number, targeted: ReadonlyArray<GeometryStroke>) => void,
): void => {
  for (let frameIndex = 0; frameIndex < sourceFrameCount; frameIndex += 1) {
    const targeted = takeTargetedStrokesFromFrame(timeline, frameIndex, targetGroupId);
    if (targeted.length === 0 || !isFrameWithinWindow(frameIndex, frameWindow)) {
      continue;
    }

    visit(frameIndex, targeted);
  }
};

export const buildTargetOriginIds = (
  timeline: GeometryTimeline,
  targetGroupId: string | null,
  options: {
    excludeMutedSources?: boolean;
    mutedGroupIds?: ReadonlySet<string>;
    mutedGeneratorIds?: ReadonlySet<string>;
  } = {},
): Set<string> => {
  const originIds = new Set<string>();
  const excludeMutedSources = options.excludeMutedSources === true;
  const mutedGroupIds = options.mutedGroupIds ?? new Set<string>();
  const mutedGeneratorIds = options.mutedGeneratorIds ?? new Set<string>();

  for (const frame of timeline.frames) {
    for (const stroke of frame.strokes) {
      if (!isTargetedStroke(stroke, targetGroupId)) {
        continue;
      }

      if (
        excludeMutedSources
        && (
          mutedGeneratorIds.has(stroke.polyline.originId)
          || (stroke.originGroupId !== null && mutedGroupIds.has(stroke.originGroupId))
        )
      ) {
        continue;
      }

      originIds.add(stroke.polyline.originId);
    }
  }

  return originIds;
};

export const cloneMask = (
  mask: GeometryMask,
): GeometryMask => ({
  contains: mask.contains,
  inverseTransform: { ...mask.inverseTransform },
});

const resolveIntraWriteOrder = (
  writeOrder: number,
): number => {
  if (!Number.isFinite(writeOrder)) {
    return 0;
  }

  const baseOrder = Math.trunc(writeOrder);
  return writeOrder - baseOrder;
};

const resolveStageWriteOrder = (
  writeOrder: number,
  stroke: GeometryStroke,
): number => writeOrder + resolveIntraWriteOrder(stroke.writeOrder);

export const resolveColorSlotWriteOrder = (
  writeOrder: number,
  slotIndex: number,
  slotCount: number,
): number => writeOrder + ((Math.max(slotCount, 1) - slotIndex) / (Math.max(slotCount, 1) + 1));

export const resolveColorSlotDestinationFrameIndexes = <T extends TimedColorSource>(
  source: T,
  startFrameIndex: number,
  destinationFrameWindow: FrameWindow,
  timelineFrameCount: number,
  shouldWrap: boolean,
): number[] => {
  if (shouldWrap) {
    return [wrapFrameIndex(startFrameIndex, timelineFrameCount)];
  }

  if (source.referenceDuration === undefined) {
    return [startFrameIndex];
  }

  const frameIndexes: number[] = [];
  for (
    let frameIndex = Math.max(destinationFrameWindow.startFrame, startFrameIndex);
    frameIndex < destinationFrameWindow.endFrameExclusive;
    frameIndex += 1
  ) {
    frameIndexes.push(frameIndex);
  }

  return frameIndexes;
};

const transformMask = (
  mask: GeometryMask,
  transform: AffineTransform | null,
): GeometryMask => {
  if (!transform) {
    return cloneMask(mask);
  }

  const inverse = invertAffine(transform);
  if (!inverse) {
    return cloneMask(mask);
  }

  return {
    contains: mask.contains,
    inverseTransform: composeAffine(mask.inverseTransform, inverse),
  };
};

export const cloneStrokeWithWriteOrder = (
  stroke: GeometryStroke,
  writeOrder: number,
): Omit<GeometryStroke, 'writeId'> => ({
  polyline: {
    ...stroke.polyline,
    points: stroke.polyline.points.map((point) => ({ ...point })),
    clipStack: stroke.polyline.clipStack.map((clip) => ({
      ...clip,
      inverseTransform: { ...clip.inverseTransform },
    })),
  },
  originGroupId: stroke.originGroupId,
  writeOrder: resolveStageWriteOrder(writeOrder, stroke),
  masks: stroke.masks.map(cloneMask),
});

export const cloneStrokeWithVelocityAndWriteOrder = (
  stroke: GeometryStroke,
  velocity: number,
  writeOrder: number,
  colorSlotIndex: number,
  colorSlotCount: number,
  colorSlotGapFill: boolean,
): Omit<GeometryStroke, 'writeId'> => ({
  polyline: {
    ...stroke.polyline,
    velocity,
    colorSlotIndex,
    colorSlotCount,
    colorSlotGapFill,
    points: stroke.polyline.points,
    clipStack: stroke.polyline.clipStack,
  },
  originGroupId: stroke.originGroupId,
  writeOrder,
  masks: stroke.masks.map(cloneMask),
});

const resolveStrokeActivationSignature = (
  stroke: Omit<GeometryStroke, 'writeId'>,
): string | undefined => {
  const coordinates = collectOccupiedCoordinates([
    {
      ...stroke,
      writeId: 0,
    },
  ], true);
  const signature = Array.from(coordinates.values())
    .map((coordinate) => `${coordinate.x},${coordinate.y}`)
    .sort()
    .join('|');
  return signature || undefined;
};

export const transformStroke = (
  stroke: GeometryStroke,
  transform: AffineTransform | null,
  writeOrder: number,
): Omit<GeometryStroke, 'writeId'> => {
  const polyline = transform
    ? applyTransformToPolyline(stroke.polyline, transform)
    : {
        ...stroke.polyline,
        points: stroke.polyline.points.map((point) => ({ ...point })),
        clipStack: stroke.polyline.clipStack.map((clip) => ({
          ...clip,
          inverseTransform: { ...clip.inverseTransform },
        })),
      };
  const transformedStroke = {
    polyline,
    originGroupId: stroke.originGroupId,
    writeOrder: resolveStageWriteOrder(writeOrder, stroke),
    masks: stroke.masks.map((mask) => transformMask(mask, transform)),
  };

  return {
    ...transformedStroke,
    polyline: {
      ...polyline,
      activationSignature: resolveStrokeActivationSignature(transformedStroke),
    },
  };
};

export const buildSourceStrokesByOriginAndFrame = (
  timeline: GeometryTimeline,
  targetOriginIds: ReadonlySet<string>,
): Map<string, Map<number, GeometryStroke[]>> => {
  const strokesByOriginId = new Map<string, Map<number, GeometryStroke[]>>();

  for (let frameIndex = 0; frameIndex < timeline.frames.length; frameIndex += 1) {
    for (const stroke of timeline.frames[frameIndex].strokes) {
      if (!targetOriginIds.has(stroke.polyline.originId)) {
        continue;
      }

      let frameMap = strokesByOriginId.get(stroke.polyline.originId);
      if (!frameMap) {
        frameMap = new Map<number, GeometryStroke[]>();
        strokesByOriginId.set(stroke.polyline.originId, frameMap);
      }

      let frameStrokes = frameMap.get(frameIndex);
      if (!frameStrokes) {
        frameStrokes = [];
        frameMap.set(frameIndex, frameStrokes);
      }

      frameStrokes.push(stroke);
    }
  }

  return strokesByOriginId;
};

const splitFrameStrokesByOriginIds = (
  strokes: ReadonlyArray<GeometryStroke>,
  targetOriginIds: ReadonlySet<string>,
): {
  targeted: GeometryStroke[];
  untargeted: GeometryStroke[];
} => {
  const targeted: GeometryStroke[] = [];
  const untargeted: GeometryStroke[] = [];

  for (const stroke of strokes) {
    if (targetOriginIds.has(stroke.polyline.originId)) {
      targeted.push(stroke);
    } else {
      untargeted.push(stroke);
    }
  }

  return { targeted, untargeted };
};

const takeOriginStrokesFromFrame = (
  timeline: GeometryTimeline,
  frameIndex: number,
  targetOriginIds: ReadonlySet<string>,
): GeometryStroke[] => {
  const { targeted, untargeted } = splitFrameStrokesByOriginIds(
    timeline.frames[frameIndex]?.strokes ?? [],
    targetOriginIds,
  );

  if (targeted.length > 0) {
    setFrameStrokes(timeline, frameIndex, untargeted);
  }

  return targeted;
};

export const stripOriginFrames = (
  timeline: GeometryTimeline,
  sourceFrameCount: number,
  targetOriginIds: ReadonlySet<string>,
): void => {
  for (let frameIndex = 0; frameIndex < sourceFrameCount; frameIndex += 1) {
    takeOriginStrokesFromFrame(timeline, frameIndex, targetOriginIds);
  }
};

export const toSourceFrameIndex = (
  beat: number,
  timeline: GeometryTimeline,
): number => {
  const frameCount = Math.max(timeline.frames.length, 1);
  return Math.min(
    Math.max(Math.floor(beat / timeline.sampleStepBeats), 0),
    frameCount - 1,
  );
};

export const addRemappedStrokeToFrame = (
  timeline: GeometryTimeline,
  frameIndex: number,
  stroke: GeometryStroke,
  writeOrder: number,
): void => {
  addStrokeToFrame(timeline, frameIndex, transformStroke(stroke, null, writeOrder));
};
