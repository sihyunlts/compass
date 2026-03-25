import { composeSceneTemporalState, NORMALIZED_TIMELINE_WINDOW } from '../../core/scene-operators/temporal';
import type { SceneInstance } from '../../core/core-types';
import type { ClipNote } from '../../shared/model';
import type { EffectDeviceEngineHandler } from '../engine-types';
import { DEFAULT_COLOR_PARAMS, sanitizeColorGapPercent } from './schema';

export interface ClipNoteWithOrigin extends ClipNote {
  originId?: string;
}

interface ColorDeviceConfig {
  velocities: number[];
  noteLengthPercent: number;
  gapPercent: number;
}

const DEFAULT_COLOR_VELOCITY = DEFAULT_COLOR_PARAMS.velocities[0];
const DEFAULT_COLOR_NOTE_LENGTH_PERCENT = DEFAULT_COLOR_PARAMS.noteLengthPercent;
const MIN_COLOR_SEGMENT = 1e-4;

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

const resolveGridExtent = (
  sceneInstances: ReadonlyArray<SceneInstance>,
): number => {
  if (sceneInstances.length === 0) {
    return 8;
  }

  const firstBounds = sceneInstances[0].sourceBounds;
  const width = Math.max(1, Math.round(firstBounds.maxX - firstBounds.minX + 1));
  const height = Math.max(1, Math.round(firstBounds.maxY - firstBounds.minY + 1));
  return Math.max(width, height);
};

const buildColorConfig = (
  effect: Parameters<EffectDeviceEngineHandler<'color'>['applyEffect']>[1],
): ColorDeviceConfig => ({
  velocities: sanitizeColorVelocities(effect.params.velocities),
  noteLengthPercent: sanitizeColorNoteLengthPercent(effect.params.noteLengthPercent),
  gapPercent: sanitizeColorGapPercent(effect.params.gapPercent),
});

const resolveReferenceDuration = (
  sourceSpan: number,
  slotCount: number,
  gridExtent: number,
): number => {
  const divisor = Math.max(gridExtent + slotCount, 1);
  return sourceSpan / divisor;
};

const buildFollowerOffsets = (
  colorConfig: ColorDeviceConfig,
  sourceSpan: number,
  gridExtent: number,
): Array<{ velocity: number; offsets: number[] }> => {
  if (!Number.isFinite(sourceSpan) || sourceSpan <= 0 || colorConfig.velocities.length === 0) {
    return [];
  }

  const referenceDuration = resolveReferenceDuration(
    sourceSpan,
    colorConfig.velocities.length,
    gridExtent,
  );
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
  const subdivisions = Math.max(
    1,
    Math.round(colorConfig.noteLengthPercent / 25),
  );

  return colorConfig.velocities.map((velocity, slotIndex) => {
    const segmentStart = slotIndex * (segmentLength + gapDuration);
    const offsets = Array.from({ length: subdivisions }, (_, subdivisionIndex) => {
      if (subdivisions === 1) {
        return segmentStart;
      }

      return segmentStart + (segmentLength * subdivisionIndex) / (subdivisions - 1);
    });

    return { velocity, offsets };
  });
};

const createFollowerSceneInstances = (
  sceneInstance: SceneInstance,
  colorConfig: ColorDeviceConfig,
  gridExtent: number,
): SceneInstance[] => {
  const sourceSpan = sceneInstance.temporal.visibilityWindow.end
    - sceneInstance.temporal.visibilityWindow.start;
  const followerOffsets = buildFollowerOffsets(colorConfig, sourceSpan, gridExtent);
  if (followerOffsets.length === 0) {
    return [{ ...sceneInstance }];
  }

  const followers: SceneInstance[] = [];
  for (const follower of followerOffsets) {
    for (const offset of follower.offsets) {
      followers.push({
        ...sceneInstance,
        velocity: follower.velocity,
        temporal: composeSceneTemporalState(sceneInstance.temporal, {
          remapToInput: {
            kind: 'affine',
            alpha: 1,
            beta: -offset,
          },
          visibilityWindow: NORMALIZED_TIMELINE_WINDOW,
        }),
      });
    }
  }

  return followers;
};

export const colorEngineHandler = {
  kind: 'color',
  applyEffect(sceneInstances, effect) {
    if (sceneInstances.length === 0) {
      return [];
    }

    const colorConfig = buildColorConfig(effect);
    const gridExtent = resolveGridExtent(sceneInstances);
    return sceneInstances.flatMap((sceneInstance) =>
      createFollowerSceneInstances(sceneInstance, colorConfig, gridExtent));
  },
} satisfies EffectDeviceEngineHandler<'color'>;
