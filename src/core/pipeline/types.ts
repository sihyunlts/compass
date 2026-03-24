import type { GeneratorChain, GeneratorDeviceNode, GeneratorNode, LaunchpadButton } from '../../shared/model';
import type { Bounds, Polyline, SceneInstance } from '../core-types';

export type GroupId = string | null;
export type MaskTimeKind = 'forward' | 'reversed';

export interface GroupChain {
  id: GroupId;
  devices: GeneratorDeviceNode[];
}

interface GroupEvaluationCache {
  sceneInstancesByGroup: Map<GroupId, SceneInstance[]>;
  outputPolylinesByGroup: Map<GroupId, Polyline[]>;
}

export interface GroupEvaluationContext {
  time: number;
  timeReversed: number;
  buttonIndex: ButtonIndex;
  chain: GeneratorChain;
  groupStateById: GeneratorChain['groupStateById'];
  worldBounds: Bounds;
  groupChains: GroupChain[];
  groupById: Map<GroupId, GroupChain>;
  generatorById: Map<string, GeneratorNode>;
  mutedGroupIds: Set<string>;
  mutedGeneratorIds: Set<string>;
  cache: GroupEvaluationCache;
}

export interface ButtonIndexGroup {
  x: number;
  y: number;
  buttons: LaunchpadButton[];
}

export interface ButtonIndex {
  groups: ReadonlyArray<ButtonIndexGroup>;
}

export interface ActivePitchInfo {
  velocity: number;
  channel: number;
  originId?: string;
}

export interface OpenNoteState {
  startBeat: number;
  velocity: number;
  channel: number;
  originId?: string;
}
