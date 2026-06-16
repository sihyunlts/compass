import type {
  BeatRange,
  OperatorExecutionPlan,
  SpatialRequirement,
} from '../../analysis/types';
import type { CompiledRackStage } from '../../plan/types';
import { toFrameWindow, type FrameWindow } from '../../timeline';
import type { RackStageExecutionContext } from './types';

const FULL_EXECUTION_BOUNDS: SpatialRequirement = 'all';
const EMPTY_EXECUTION_PLAN: OperatorExecutionPlan = Object.freeze({
  requiredOutputBounds: FULL_EXECUTION_BOUNDS,
  generatorOutputBounds: FULL_EXECUTION_BOUNDS,
  requiredInputRoi: FULL_EXECUTION_BOUNDS,
  requiredSourceRoi: 'none',
  requiredFrameWindow: 'all',
  requiredSourceFrameWindow: 'none',
});

export const resolveStageExecutionPlan = (
  context: RackStageExecutionContext,
  stage: CompiledRackStage,
): OperatorExecutionPlan => context.executionPlanByDeviceId.get(stage.deviceId) ?? EMPTY_EXECUTION_PLAN;

export const resolveFrameWindow = (
  requirement: BeatRange | 'all' | 'none',
  sampleStepBeats: number,
  frameCount: number,
): FrameWindow => {
  if (requirement === 'all') {
    return {
      startFrame: 0,
      endFrameExclusive: frameCount,
    };
  }

  if (requirement === 'none') {
    return {
      startFrame: 0,
      endFrameExclusive: 0,
    };
  }

  return toFrameWindow(requirement, sampleStepBeats, frameCount);
};

export const isFrameWithinWindow = (
  frameIndex: number,
  window: FrameWindow,
): boolean => frameIndex >= window.startFrame && frameIndex < window.endFrameExclusive;
