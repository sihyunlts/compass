import {
  COMPOSITION_CENTER,
  toAxisMirrorTransformAt,
  toMirrorTransformAt,
  toRotateTransformAt,
  toScaleTransformAt,
  toTranslationTransform,
} from '../../core/geometry';
import { isIdentityTimeWarpCurve } from '../../core/timewarp/curve';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import type { BeatRange } from './types';
import { createSpatialBounds, transformSpatialRequirement, unionSpatialRequirements } from './bounds';
import type { CanonicalAnalysisResult, OperatorAnalysis, SpatialRequirement } from './types';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type {
  GeneratorEffectNode,
  GeneratorNode,
  GeneratorChain,
  MaskEffectNode,
} from '../../shared/model';

const DEFAULT_TIME_DOMAIN: BeatRange = Object.freeze({
  start: 0,
  end: 1,
});

const createOperatorAnalysis = (
  partial: Partial<OperatorAnalysis> = {},
): OperatorAnalysis => ({
  outputBounds: partial.outputBounds ?? 'all',
  inputRoi: partial.inputRoi ?? 'all',
  framesNeeded: partial.framesNeeded ?? 'unknown',
  timeDomain: partial.timeDomain ?? DEFAULT_TIME_DOMAIN,
  isIdentity: partial.isIdentity ?? false,
});

const createBoundsFromPoints = (
  points: ReadonlyArray<{ x: number; y: number }>,
): SpatialRequirement => {
  if (points.length === 0) {
    return 'none';
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }

    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return 'none';
  }

  return createSpatialBounds(minX, maxX, minY, maxY);
};

const normalizeAngle = (angleDeg: number): number => {
  const normalized = angleDeg % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

const unionBeatRanges = (
  left: BeatRange,
  right: BeatRange,
): BeatRange => ({
  start: Math.min(left.start, right.start),
  end: Math.max(left.end, right.end),
});

const isGroupTargetedEffect = (
  groupId: string | null | undefined,
): boolean => normalizeOptionalId(groupId) !== null;

const mergeTargetedOutputBounds = (
  groupId: string | null | undefined,
  upstream: SpatialRequirement,
  transformed: SpatialRequirement,
): SpatialRequirement => (
  isGroupTargetedEffect(groupId)
    ? unionSpatialRequirements(upstream, transformed)
    : transformed
);

const mergeTargetedTimeDomain = (
  groupId: string | null | undefined,
  upstream: BeatRange,
  transformed: BeatRange,
): BeatRange => (
  isGroupTargetedEffect(groupId)
    ? unionBeatRanges(upstream, transformed)
    : transformed
);

const buildGeneratorAnalysis = (
  device: GeneratorNode,
): OperatorAnalysis => {
  if (device.kind === 'waterdrop') {
    const radius = Math.max(Math.abs(device.params.curvature), 0.5);
    return createOperatorAnalysis({
      outputBounds: createSpatialBounds(
        device.params.centerX - radius,
        device.params.centerX + radius,
        device.params.centerY - radius,
        device.params.centerY + radius,
      ),
      inputRoi: 'none',
      framesNeeded: 'current',
    });
  }

  if (device.kind === 'scanner') {
    return createOperatorAnalysis({
      outputBounds: 'all',
      inputRoi: 'none',
      framesNeeded: 'current',
    });
  }

  if (device.kind === 'spiral') {
    const radius = Math.max(Math.abs(device.params.turns), 1);
    return createOperatorAnalysis({
      outputBounds: createSpatialBounds(
        device.params.centerX - radius,
        device.params.centerX + radius,
        device.params.centerY - radius,
        device.params.centerY + radius,
      ),
      inputRoi: 'none',
      framesNeeded: 'current',
    });
  }

  return createOperatorAnalysis({
    outputBounds: createBoundsFromPoints(device.params.points),
    inputRoi: 'none',
    framesNeeded: 'current',
  });
};

const buildSpatialEffectAnalysis = (
  device: GeneratorEffectNode,
  upstream: OperatorAnalysis,
): OperatorAnalysis | null => {
  if (device.kind === 'translate') {
    const transformedBounds = transformSpatialRequirement(
      upstream.outputBounds,
      toTranslationTransform(device.params.offsetX, device.params.offsetY),
    );
    return createOperatorAnalysis({
      outputBounds: mergeTargetedOutputBounds(
        device.groupId,
        upstream.outputBounds,
        transformedBounds,
      ),
      inputRoi: upstream.outputBounds,
      framesNeeded: 'current',
      timeDomain: mergeTargetedTimeDomain(device.groupId, upstream.timeDomain, upstream.timeDomain),
      isIdentity: device.params.offsetX === 0 && device.params.offsetY === 0,
    });
  }

  if (device.kind === 'rotate') {
    const transformedBounds = transformSpatialRequirement(
      upstream.outputBounds,
      toRotateTransformAt(device.params.angleDeg, COMPOSITION_CENTER),
    );
    return createOperatorAnalysis({
      outputBounds: mergeTargetedOutputBounds(
        device.groupId,
        upstream.outputBounds,
        transformedBounds,
      ),
      inputRoi: upstream.outputBounds,
      framesNeeded: 'current',
      timeDomain: mergeTargetedTimeDomain(device.groupId, upstream.timeDomain, upstream.timeDomain),
      isIdentity: normalizeAngle(device.params.angleDeg) === 0,
    });
  }

  if (device.kind === 'scale') {
    const transform = toScaleTransformAt(
      device.params.scaleX,
      device.params.scaleY,
      {
        x: device.params.centerX,
        y: device.params.centerY,
      },
    );
    const transformedBounds = transform
      ? transformSpatialRequirement(upstream.outputBounds, transform)
      : 'all';
    return createOperatorAnalysis({
      outputBounds: mergeTargetedOutputBounds(device.groupId, upstream.outputBounds, transformedBounds),
      inputRoi: upstream.outputBounds,
      framesNeeded: 'current',
      timeDomain: mergeTargetedTimeDomain(device.groupId, upstream.timeDomain, upstream.timeDomain),
      isIdentity: device.params.scaleX === 1 && device.params.scaleY === 1,
    });
  }

  if (device.kind === 'mirror') {
    const transformedBounds = transformSpatialRequirement(
      upstream.outputBounds,
      toMirrorTransformAt(device.params.angleDeg, COMPOSITION_CENTER),
    );
    return createOperatorAnalysis({
      outputBounds: mergeTargetedOutputBounds(
        device.groupId,
        upstream.outputBounds,
        transformedBounds,
      ),
      inputRoi: upstream.outputBounds,
      framesNeeded: 'current',
      timeDomain: mergeTargetedTimeDomain(device.groupId, upstream.timeDomain, upstream.timeDomain),
      isIdentity: false,
    });
  }

  if (device.kind === 'symmetry') {
    if (device.params.mode === 'mirror-half') {
      const horizontalBounds = transformSpatialRequirement(
        upstream.outputBounds,
        toAxisMirrorTransformAt(device.params.axis, COMPOSITION_CENTER),
      );
      return createOperatorAnalysis({
        outputBounds: mergeTargetedOutputBounds(
          device.groupId,
          upstream.outputBounds,
          unionSpatialRequirements(upstream.outputBounds, horizontalBounds),
        ),
        inputRoi: upstream.outputBounds,
        framesNeeded: 'current',
        timeDomain: mergeTargetedTimeDomain(device.groupId, upstream.timeDomain, upstream.timeDomain),
        isIdentity: false,
      });
    }

    const rotate90Bounds = transformSpatialRequirement(
      upstream.outputBounds,
      toRotateTransformAt(90, COMPOSITION_CENTER),
    );
    const rotate180Bounds = transformSpatialRequirement(
      upstream.outputBounds,
      toRotateTransformAt(180, COMPOSITION_CENTER),
    );
    const rotate270Bounds = transformSpatialRequirement(
      upstream.outputBounds,
      toRotateTransformAt(270, COMPOSITION_CENTER),
    );
    return createOperatorAnalysis({
      outputBounds: mergeTargetedOutputBounds(
        device.groupId,
        upstream.outputBounds,
        unionSpatialRequirements(
          unionSpatialRequirements(upstream.outputBounds, rotate90Bounds),
          unionSpatialRequirements(rotate180Bounds, rotate270Bounds),
        ),
      ),
      inputRoi: upstream.outputBounds,
      framesNeeded: 'current',
      timeDomain: mergeTargetedTimeDomain(device.groupId, upstream.timeDomain, upstream.timeDomain),
      isIdentity: false,
    });
  }

  return null;
};

const buildTemporalEffectAnalysis = (
  device: GeneratorEffectNode,
  upstream: OperatorAnalysis,
): OperatorAnalysis | null => {
  if (device.kind === 'reverse') {
    return createOperatorAnalysis({
      outputBounds: upstream.outputBounds,
      inputRoi: upstream.outputBounds,
      framesNeeded: 'timeline',
      timeDomain: mergeTargetedTimeDomain(device.groupId, upstream.timeDomain, upstream.timeDomain),
      isIdentity: false,
    });
  }

  if (device.kind === 'trim') {
    const transformedTimeDomain = clampTimeDomain(
      upstream.timeDomain,
      device.params.start,
      device.params.end,
    );
    return createOperatorAnalysis({
      outputBounds: upstream.outputBounds,
      inputRoi: upstream.outputBounds,
      framesNeeded: 'timeline',
      timeDomain: mergeTargetedTimeDomain(device.groupId, upstream.timeDomain, transformedTimeDomain),
      isIdentity: device.params.start === 0 && device.params.end === 1,
    });
  }

  if (device.kind === 'stretch') {
    const transformedTimeDomain = {
      start: device.params.start,
      end: device.params.end,
    };
    return createOperatorAnalysis({
      outputBounds: upstream.outputBounds,
      inputRoi: upstream.outputBounds,
      framesNeeded: 'timeline',
      timeDomain: mergeTargetedTimeDomain(device.groupId, upstream.timeDomain, transformedTimeDomain),
      isIdentity: device.params.start === 0 && device.params.end === 1,
    });
  }

  if (device.kind === 'timewarp') {
    return createOperatorAnalysis({
      outputBounds: upstream.outputBounds,
      inputRoi: upstream.outputBounds,
      framesNeeded: 'timeline',
      timeDomain: mergeTargetedTimeDomain(device.groupId, upstream.timeDomain, upstream.timeDomain),
      isIdentity: isIdentityTimeWarpCurve(device.params.curve),
    });
  }

  return null;
};

const clampTimeDomain = (
  upstream: BeatRange,
  start: number,
  end: number,
): BeatRange => ({
  start: Math.max(upstream.start, start),
  end: Math.min(upstream.end, end),
});

const buildMaskAnalysis = (
  device: MaskEffectNode,
  upstream: OperatorAnalysis,
): OperatorAnalysis => {
  const sourceBounds = device.params.sourceKind === 'tiles'
    ? 'none'
    : upstream.outputBounds;

  return createOperatorAnalysis({
    outputBounds: upstream.outputBounds,
    inputRoi: device.params.sourceKind === 'tiles'
      ? upstream.outputBounds
      : unionSpatialRequirements(upstream.outputBounds, sourceBounds),
    framesNeeded: device.params.sourceDomain === 'activation' ? 'timeline' : 'current',
    timeDomain: upstream.timeDomain,
    isIdentity: false,
  });
};

const buildColorAnalysis = (
  upstream: OperatorAnalysis,
): OperatorAnalysis => createOperatorAnalysis({
  outputBounds: upstream.outputBounds,
  inputRoi: upstream.outputBounds,
  framesNeeded: 'timeline',
  timeDomain: upstream.timeDomain,
  isIdentity: false,
});

export const buildCanonicalAnalysisResult = (
  chain: GeneratorChain,
): CanonicalAnalysisResult => {
  const byDeviceId = new Map<string, OperatorAnalysis>();
  let currentAnalysis = createOperatorAnalysis({
    outputBounds: 'none',
    inputRoi: 'none',
    framesNeeded: 'unknown',
  });

  for (const device of chain.devices) {
    if (!isDeviceEffectivelyEnabled(chain, device) || device.kind === 'modulator') {
      continue;
    }

    if (device.kind === 'waterdrop'
      || device.kind === 'scanner'
      || device.kind === 'spiral'
      || device.kind === 'path') {
      const generatorAnalysis = buildGeneratorAnalysis(device);
      currentAnalysis = createOperatorAnalysis({
        ...generatorAnalysis,
        outputBounds: unionSpatialRequirements(currentAnalysis.outputBounds, generatorAnalysis.outputBounds),
        timeDomain: unionBeatRanges(currentAnalysis.timeDomain, generatorAnalysis.timeDomain),
      });
      byDeviceId.set(device.id, currentAnalysis);
      continue;
    }

    if (device.kind === 'color') {
      currentAnalysis = buildColorAnalysis(currentAnalysis);
      byDeviceId.set(device.id, currentAnalysis);
      continue;
    }

    if (device.kind === 'mask') {
      currentAnalysis = buildMaskAnalysis(device, currentAnalysis);
      byDeviceId.set(device.id, currentAnalysis);
      continue;
    }

    const spatialAnalysis = buildSpatialEffectAnalysis(device, currentAnalysis);
    if (spatialAnalysis) {
      currentAnalysis = spatialAnalysis;
      byDeviceId.set(device.id, currentAnalysis);
      continue;
    }

    const temporalAnalysis = buildTemporalEffectAnalysis(device, currentAnalysis);
    if (temporalAnalysis) {
      currentAnalysis = temporalAnalysis;
      byDeviceId.set(device.id, currentAnalysis);
    }
  }

  return {
    byDeviceId,
    finalOutputBounds: currentAnalysis.outputBounds,
    finalTimeDomain: currentAnalysis.timeDomain,
  };
};
