import type { GeneratorChain, GeneratorDeviceNode, GeneratorNode, LaunchpadButton } from '../../shared/model';
import type { Bounds, GeneratorLayer, Polyline, Vec2 } from '../core-types';
import type { ColorGuideWarp } from '../../devices/color/engine';

export interface OriginWindow {
  min: number;
  max: number;
}

export type GroupId = string | null;
export type MaskTimeKind = 'forward' | 'reversed';

export interface GroupChain {
  id: GroupId;
  devices: GeneratorDeviceNode[];
}

interface GroupEvaluationCache {
  layersByGroup: Map<GroupId, GeneratorLayer[]>;
  sourcePolylinesByGroup: Map<GroupId, Polyline[]>;
  sourcePolylinesByGroupReversed: Map<GroupId, Polyline[]>;
  resolvingSourcePolylinesByGroup: Set<GroupId>;
  resolvingSourcePolylinesByGroupReversed: Set<GroupId>;
  sourceColorGuideWarpByGroup: Map<GroupId, ReadonlyMap<string, ColorGuideWarp>>;
  outputPolylinesByGroup: Map<GroupId, Polyline[]>;
}

export interface GroupEvaluationContext {
  time: number;
  timeReversed: number;
  buttonIndex: ButtonIndex;
  chain: GeneratorChain;
  groupStateById: GeneratorChain['groupStateById'];
  worldBounds: Bounds;
  originWindows?: Map<string, OriginWindow>;
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
  coordinates: ReadonlyArray<Vec2>;
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
