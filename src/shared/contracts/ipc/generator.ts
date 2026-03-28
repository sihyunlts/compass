import type { BridgeSettings, BridgeTarget } from '../../bridge/types';
import type { GeneratorChain, LaunchpadModel } from '../../model';
import type { GeneratorPreview } from '../preview/generator-preview';

export interface GenerateAndSendRequest {
  chain: GeneratorChain;
  bridge: BridgeSettings;
  launchpadModel?: LaunchpadModel;
  sourceKey?: string;
}

export interface GenerateAndSendResponse {
  sentAtIso: string;
  target: BridgeTarget;
  bridge: BridgeSettings;
  preview: GeneratorPreview;
}

export interface RequestLiveTempoResponse {
  sentAtIso: string;
  target: BridgeTarget;
}
