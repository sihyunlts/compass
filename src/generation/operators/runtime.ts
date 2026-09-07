export {
  materializeRackState,
  materializeAndNormalizeRackTimeline,
  prepareRackOperatorInput,
  replaceTimelineAndRefreshRackState,
} from './runtime/materialization';
export {
  createModulationContext,
  isDeviceModulated,
  resolveModulatedDeviceAtFrame,
  type ModulationEvaluationWindow,
} from './runtime/modulation';
export {
  buildModulationEvaluationWindowByOriginId,
} from './runtime/modulation-evaluation';
export {
  appendPendingGeometryRewriteApplication,
  appendPendingStrokeRewriteApplication,
  buildPendingStrokeRewriteFrameWrites,
} from './runtime/pending-frame-applications';
export {
  createRackStageExecutionContext,
  resolveMaskReferenceMutedGeneratorIds,
  resolveMaskReferenceMutedGroupIds,
  shouldApplyReferenceStage,
} from './runtime/reference';
export {
  seedGeneratedOriginTimelineState,
} from './runtime/timeline-state';
export {
  buildTargetOriginIds,
  transformStroke,
  createStrokeTransformer,
} from './runtime/timeline-strokes';
export {
  createRackOperator,
  type GeneratorStageKind,
  type MaskSourceReferenceContext,
  type MaskSourceReferenceRequest,
  type MaskSourceReferenceResult,
  type ModulationContext,
  type RackOperator,
  type RackStageExecutionContext,
  type RackStageOfKind,
  type SpatialTransformStageKind,
} from './runtime/types';
