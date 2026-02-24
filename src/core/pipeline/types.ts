import type {
  GeneratorChain,
  GeneratorDeviceNode,
  GeneratorNode,
  LaunchpadButton,
} from '../../shared/types';
import type { Bounds, GeneratorLayer, Polyline, Vec2 } from '../core-types';

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
  outputPolylinesByGroup: Map<GroupId, Polyline[]>;
  activeTilesByGroup: Map<GroupId, Set<number>>;
  activeTilesByGroupReversed: Map<GroupId, Set<number>>;
  activeTilesByGenerator: Map<string, Set<number>>;
  activeTilesByGeneratorReversed: Map<string, Set<number>>;
  resolvingGroupTiles: Set<GroupId>;
  resolvingGroupTilesReversed: Set<GroupId>;
  resolvingGeneratorTiles: Set<string>;
  resolvingGeneratorTilesReversed: Set<string>;
}

export interface GroupEvaluationContext {
  time: number;
  timeReversed: number;
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
}

export interface OpenNoteState {
  startBeat: number;
  velocity: number;
  channel: number;
}
