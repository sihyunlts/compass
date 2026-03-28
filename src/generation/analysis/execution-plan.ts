import {
  invertAffine,
  COMPOSITION_CENTER,
  toAxisMirrorTransformAt,
  toMirrorTransformAt,
  toRotateTransformAt,
  toScaleTransformAt,
  toTranslationTransform,
} from '../../core/geometry';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import type {
  BeatRange,
  CanonicalExecutionPlan,
  CanonicalExecutionRequest,
  OperatorExecutionPlan,
  SpatialRequirement,
} from './types';
import { transformSpatialRequirement, unionSpatialRequirements } from './bounds';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type {
  GeneratorChain,
  GeneratorDeviceNode,
  GeneratorEffectNode,
  SymmetryEffectNode,
} from '../../shared/model';

const NONE_REQUIREMENT: SpatialRequirement = 'none';
const NONE_TIME_WINDOW = 'none' as const;
const ALL_TIME_WINDOW = 'all' as const;

const clampBeatRange = (
  range: BeatRange,
): BeatRange => {
  const start = Number.isFinite(range.start) ? range.start : 0;
  const end = Number.isFinite(range.end) ? range.end : start;
  return {
    start: Math.max(start, 0),
    end: Math.max(end, Math.max(start, 0)),
  };
};

const intersectBeatRanges = (
  left: BeatRange,
  right: BeatRange,
): BeatRange => ({
  start: Math.max(left.start, right.start),
  end: Math.max(Math.max(left.start, right.start), Math.min(left.end, right.end)),
});

const mergeTargetedFrameWindow = (
  groupId: string | null | undefined,
  requiredOutputWindow: BeatRange | 'all',
  requiredInputWindow: BeatRange | 'all',
): BeatRange | 'all' => {
  if (requiredOutputWindow === 'all' || requiredInputWindow === 'all') {
    return ALL_TIME_WINDOW;
  }

  if (!isGroupTargetedEffect(groupId)) {
    return requiredInputWindow;
  }

  return {
    start: Math.min(requiredOutputWindow.start, requiredInputWindow.start),
    end: Math.max(requiredOutputWindow.end, requiredInputWindow.end),
  };
};

const remapTrimInputWindow = (
  requiredOutputWindow: BeatRange,
  trimWindow: BeatRange,
): BeatRange => {
  if (trimWindow.end <= trimWindow.start) {
    return trimWindow;
  }

  return intersectBeatRanges(requiredOutputWindow, trimWindow);
};

const remapStretchInputWindow = (
  requiredOutputWindow: BeatRange,
  stretchWindow: BeatRange,
): BeatRange => {
  const visibleWindow = intersectBeatRanges(requiredOutputWindow, stretchWindow);
  const span = stretchWindow.end - stretchWindow.start;
  if (!Number.isFinite(span) || span <= 0) {
    return { start: 0, end: 0 };
  }

  return {
    start: Math.max((visibleWindow.start - stretchWindow.start) / span, 0),
    end: Math.max((visibleWindow.end - stretchWindow.start) / span, 0),
  };
};

const isGroupTargetedEffect = (
  groupId: string | null | undefined,
): boolean => normalizeOptionalId(groupId) !== null;

const mergeTargetedInputRoi = (
  groupId: string | null | undefined,
  requiredOutputBounds: SpatialRequirement,
  transformedInputRoi: SpatialRequirement,
): SpatialRequirement => (
  isGroupTargetedEffect(groupId)
    ? unionSpatialRequirements(requiredOutputBounds, transformedInputRoi)
    : transformedInputRoi
);

const invertRequirementThroughTransform = (
  requirement: SpatialRequirement,
  transform: ReturnType<typeof toTranslationTransform> | null,
): SpatialRequirement => {
  if (!transform) {
    return 'all';
  }

  const inverse = invertAffine(transform);
  if (!inverse) {
    return 'all';
  }

  return transformSpatialRequirement(requirement, inverse);
};

const resolveSymmetryInputRoi = (
  effect: SymmetryEffectNode,
  requirement: SpatialRequirement,
): SpatialRequirement => {
  if (effect.params.mode === 'mirror-half') {
    return unionSpatialRequirements(
      requirement,
      transformSpatialRequirement(
        requirement,
        toAxisMirrorTransformAt(effect.params.axis, COMPOSITION_CENTER),
      ),
    );
  }

  if (effect.params.mode === 'quad-mirror') {
    const horizontal = transformSpatialRequirement(
      requirement,
      toAxisMirrorTransformAt('horizontal', COMPOSITION_CENTER),
    );
    const vertical = transformSpatialRequirement(
      requirement,
      toAxisMirrorTransformAt('vertical', COMPOSITION_CENTER),
    );
    return unionSpatialRequirements(
      unionSpatialRequirements(requirement, horizontal),
      unionSpatialRequirements(
        vertical,
        transformSpatialRequirement(horizontal, toAxisMirrorTransformAt('vertical', COMPOSITION_CENTER)),
      ),
    );
  }

  const rotate90 = transformSpatialRequirement(
    requirement,
    toRotateTransformAt(90, COMPOSITION_CENTER),
  );
  const rotate180 = transformSpatialRequirement(
    requirement,
    toRotateTransformAt(180, COMPOSITION_CENTER),
  );
  const rotate270 = transformSpatialRequirement(
    requirement,
    toRotateTransformAt(270, COMPOSITION_CENTER),
  );
  return unionSpatialRequirements(
    unionSpatialRequirements(requirement, rotate90),
    unionSpatialRequirements(rotate180, rotate270),
  );
};

const buildSpatialInputRoi = (
  device: GeneratorEffectNode,
  requiredOutputBounds: SpatialRequirement,
): SpatialRequirement | null => {
  if (device.kind === 'translate') {
    return invertRequirementThroughTransform(
      requiredOutputBounds,
      toTranslationTransform(device.params.offsetX, device.params.offsetY),
    );
  }

  if (device.kind === 'rotate') {
    return invertRequirementThroughTransform(
      requiredOutputBounds,
      toRotateTransformAt(device.params.angleDeg, COMPOSITION_CENTER),
    );
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
    return invertRequirementThroughTransform(
      requiredOutputBounds,
      transform ?? toTranslationTransform(0, 0),
    );
  }

  if (device.kind === 'mirror') {
    return transformSpatialRequirement(
      requiredOutputBounds,
      toMirrorTransformAt(device.params.angleDeg, COMPOSITION_CENTER),
    );
  }

  if (device.kind === 'symmetry') {
    return resolveSymmetryInputRoi(device, requiredOutputBounds);
  }

  return null;
};

const buildOperatorExecutionPlan = (
  device: GeneratorDeviceNode,
  requiredOutputBounds: SpatialRequirement,
  requiredFrameWindow: BeatRange | 'all',
): OperatorExecutionPlan => {
  if (device.kind === 'modulator') {
    return {
      requiredOutputBounds,
      requiredInputRoi: requiredOutputBounds,
      requiredSourceRoi: NONE_REQUIREMENT,
      requiredFrameWindow: requiredFrameWindow,
      requiredSourceFrameWindow: NONE_TIME_WINDOW,
    };
  }

  if (
    device.kind === 'waterdrop'
    || device.kind === 'scanner'
    || device.kind === 'spiral'
    || device.kind === 'path'
  ) {
    return {
      requiredOutputBounds,
      requiredInputRoi: NONE_REQUIREMENT,
      requiredSourceRoi: NONE_REQUIREMENT,
      requiredFrameWindow,
      requiredSourceFrameWindow: NONE_TIME_WINDOW,
    };
  }

  if (device.kind === 'color') {
    const requiredInputRoi = mergeTargetedInputRoi(
      device.groupId,
      requiredOutputBounds,
      requiredOutputBounds,
    );
    return {
      requiredOutputBounds,
      requiredInputRoi,
      requiredSourceRoi: NONE_REQUIREMENT,
      requiredFrameWindow: ALL_TIME_WINDOW,
      requiredSourceFrameWindow: NONE_TIME_WINDOW,
    };
  }

  if (device.kind === 'mask') {
    const requiredInputRoi = mergeTargetedInputRoi(
      device.groupId,
      requiredOutputBounds,
      requiredOutputBounds,
    );
    return {
      requiredOutputBounds,
      requiredInputRoi,
      requiredSourceRoi: device.params.sourceKind === 'tiles'
        ? NONE_REQUIREMENT
        : requiredOutputBounds,
      requiredFrameWindow,
      requiredSourceFrameWindow: device.params.sourceKind === 'tiles'
        ? NONE_TIME_WINDOW
        : requiredFrameWindow,
    };
  }

  if (device.kind === 'reverse') {
    return {
      requiredOutputBounds,
      requiredInputRoi: mergeTargetedInputRoi(device.groupId, requiredOutputBounds, requiredOutputBounds),
      requiredSourceRoi: NONE_REQUIREMENT,
      requiredFrameWindow: ALL_TIME_WINDOW,
      requiredSourceFrameWindow: NONE_TIME_WINDOW,
    };
  }

  if (device.kind === 'trim') {
    const trimWindow = clampBeatRange({
      start: device.params.start,
      end: device.params.end,
    });
    const requiredInputWindow = requiredFrameWindow === 'all'
      ? ALL_TIME_WINDOW
      : remapTrimInputWindow(requiredFrameWindow, trimWindow);
    return {
      requiredOutputBounds,
      requiredInputRoi: mergeTargetedInputRoi(device.groupId, requiredOutputBounds, requiredOutputBounds),
      requiredSourceRoi: NONE_REQUIREMENT,
      requiredFrameWindow: requiredInputWindow,
      requiredSourceFrameWindow: NONE_TIME_WINDOW,
    };
  }

  if (device.kind === 'stretch') {
    const stretchWindow = clampBeatRange({
      start: device.params.start,
      end: device.params.end,
    });
    const requiredInputWindow = requiredFrameWindow === 'all'
      ? ALL_TIME_WINDOW
      : remapStretchInputWindow(requiredFrameWindow, stretchWindow);
    return {
      requiredOutputBounds,
      requiredInputRoi: mergeTargetedInputRoi(device.groupId, requiredOutputBounds, requiredOutputBounds),
      requiredSourceRoi: NONE_REQUIREMENT,
      requiredFrameWindow: requiredInputWindow,
      requiredSourceFrameWindow: NONE_TIME_WINDOW,
    };
  }

  if (device.kind === 'timewarp') {
    return {
      requiredOutputBounds,
      requiredInputRoi: mergeTargetedInputRoi(device.groupId, requiredOutputBounds, requiredOutputBounds),
      requiredSourceRoi: NONE_REQUIREMENT,
      requiredFrameWindow: ALL_TIME_WINDOW,
      requiredSourceFrameWindow: NONE_TIME_WINDOW,
    };
  }

  if (
    device.kind === 'translate'
    || device.kind === 'rotate'
    || device.kind === 'scale'
    || device.kind === 'mirror'
    || device.kind === 'symmetry'
  ) {
    const spatialInputRoi = buildSpatialInputRoi(device, requiredOutputBounds);
    return {
      requiredOutputBounds,
      requiredInputRoi: mergeTargetedInputRoi(
        device.groupId,
        requiredOutputBounds,
        spatialInputRoi ?? requiredOutputBounds,
      ),
      requiredSourceRoi: NONE_REQUIREMENT,
      requiredFrameWindow,
      requiredSourceFrameWindow: NONE_TIME_WINDOW,
    };
  }

  return {
    requiredOutputBounds,
    requiredInputRoi: requiredOutputBounds,
    requiredSourceRoi: NONE_REQUIREMENT,
    requiredFrameWindow,
    requiredSourceFrameWindow: NONE_TIME_WINDOW,
  };
};

export const buildCanonicalExecutionPlan = (
  chain: GeneratorChain,
  executionRequest: CanonicalExecutionRequest,
): CanonicalExecutionPlan => {
  const byDeviceId = new Map<string, OperatorExecutionPlan>();
  let currentRequiredOutputBounds = executionRequest.outputBounds;
  let currentRequiredFrameWindow: BeatRange | 'all' = clampBeatRange(executionRequest.timeDomain);

  for (let index = chain.devices.length - 1; index >= 0; index -= 1) {
    const device = chain.devices[index];
    if (!isDeviceEffectivelyEnabled(chain, device) || device.kind === 'modulator') {
      continue;
    }

    const devicePlan = buildOperatorExecutionPlan(
      device,
      currentRequiredOutputBounds,
      currentRequiredFrameWindow,
    );
    byDeviceId.set(device.id, devicePlan);

    if (
      device.kind === 'waterdrop'
      || device.kind === 'scanner'
      || device.kind === 'spiral'
      || device.kind === 'path'
    ) {
      continue;
    }

    currentRequiredOutputBounds = devicePlan.requiredInputRoi;
    currentRequiredFrameWindow = mergeTargetedFrameWindow(
      device.groupId,
      currentRequiredFrameWindow,
      devicePlan.requiredFrameWindow,
    );
  }

  return {
    byDeviceId,
    finalRequest: executionRequest,
  };
};
