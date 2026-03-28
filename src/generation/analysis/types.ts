export interface BeatRange {
  start: number;
  end: number;
}

export interface SpatialBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export type SpatialRequirement = SpatialBounds | 'all' | 'none';

export interface OperatorAnalysis {
  outputBounds: SpatialRequirement;
  inputRoi: SpatialRequirement;
  framesNeeded: 'current' | 'timeline' | 'unknown';
  timeDomain: BeatRange;
  isIdentity: boolean;
}

export interface CanonicalAnalysisResult {
  byDeviceId: Map<string, OperatorAnalysis>;
  finalOutputBounds: SpatialRequirement;
  finalTimeDomain: BeatRange;
}

export interface CanonicalExecutionRequest {
  outputBounds: SpatialRequirement;
  timeDomain: BeatRange;
}

export interface OperatorExecutionPlan {
  requiredOutputBounds: SpatialRequirement;
  requiredInputRoi: SpatialRequirement;
  requiredSourceRoi: SpatialRequirement;
}

export interface CanonicalExecutionPlan {
  byDeviceId: Map<string, OperatorExecutionPlan>;
  finalRequest: CanonicalExecutionRequest;
}
