export {
  isFrameWithinWindow,
  resolveFrameWindow,
  resolveStageExecutionPlan,
} from './runtime/frame-window';
export {
  createPendingFrameApplicationOperator,
  createPendingGeometryApplicationOperator,
  materializeAndNormalizeRackState,
  preservePendingRackOperatorInput,
  replaceTimelineAndRefreshRackState,
  type PendingGeometryApplicationOperatorInput,
} from './runtime/materialization';
export {
  createModulationContext,
  isDeviceModulated,
  resolveModulatedDeviceAtFrame,
} from './runtime/modulation';
export {
  appendPendingColorApplication,
  appendPendingGeometryRewriteApplication,
  appendPendingStrokeRewriteApplication,
  buildPendingStrokeRewriteFrameWrites,
} from './runtime/pending-frame-applications';
export {
  buildTemporalStateUpdatesForTargetOrigins,
  createTemporalStateUpdateOperator,
} from './runtime/pending-temporal';
export {
  createRackStageExecutionContext,
  resolveMaskReferenceMutedGeneratorIds,
  resolveMaskReferenceMutedGroupIds,
  shouldApplyReferenceStage,
} from './runtime/reference';
export {
  mergePlaybackWindowOverridesIntoTimelineState,
  seedGeneratedOriginTimelineState,
} from './runtime/timeline-state';
export {
  buildTargetOriginIds,
  cloneMask,
  cloneStrokeWithWriteOrder,
  transformStroke,
} from './runtime/timeline-strokes';
export {
  createRackOperator,
  type GeneratorStageKind,
  type MaskSourceReferenceContext,
  type ModulationContext,
  type PendingFrameApplicationOperatorInput,
  type RackOperator,
  type RackStageExecutionContext,
  type RackStageOfKind,
  type SpatialTransformStageKind,
} from './runtime/types';
