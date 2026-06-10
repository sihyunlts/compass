import type { BridgeSettings, BridgeTarget } from '../../bridge/types';
import type { GeneratorPreview } from '../preview/generator-preview';

export interface SendGeneratedPreviewRequest {
  preview: GeneratorPreview;
  bridge: BridgeSettings;
}

export interface SendGeneratedPreviewResponse {
  sentAtIso: string;
  target: BridgeTarget;
  bridge: BridgeSettings;
  preview: GeneratorPreview;
}

export interface RequestLiveTempoResponse {
  sentAtIso: string;
  target: BridgeTarget;
}
