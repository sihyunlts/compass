import type { BridgeSettings, BridgeTarget } from '../../bridge';
import type { GeneratorChain, LaunchpadModel } from '../../model';
import type { GeneratorPreview } from '../preview';

export interface GenerateAndSendRequest {
  chain: GeneratorChain;
  bridge: BridgeSettings;
  launchpadModel?: LaunchpadModel;
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
