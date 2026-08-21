import type { AuthoredMetadata } from './authored-metadata';

export interface RippleParams {
  centerX: number;
  centerY: number;
  curvature: number;
}

export interface GroupedDeviceNode {
  groupId?: string | null;
  name?: string | null;
  metadata?: AuthoredMetadata;
}

export interface RippleGeneratorNode extends GroupedDeviceNode {
  id: string;
  kind: 'ripple';
  enabled: boolean;
  params: RippleParams;
}

export interface ScannerParams {
  angleDeg: number;
}

export interface ScannerGeneratorNode extends GroupedDeviceNode {
  id: string;
  kind: 'scanner';
  enabled: boolean;
  params: ScannerParams;
}

export interface RainParams {
  seed: number;
  angleDeg: number;
  density: number;
  speed: number;
}

export interface RainGeneratorNode extends GroupedDeviceNode {
  id: string;
  kind: 'rain';
  enabled: boolean;
  params: RainParams;
}

export interface SpiralParams {
  centerX: number;
  centerY: number;
  turns: number;
}

export interface SpiralGeneratorNode extends GroupedDeviceNode {
  id: string;
  kind: 'spiral';
  enabled: boolean;
  params: SpiralParams;
}

export interface PathHandle {
  x: number;
  y: number;
}

export interface PathAnchor {
  id: string;
  x: number;
  y: number;
  handleIn?: PathHandle;
  handleOut?: PathHandle;
}

export interface PathAnimation {
  enabled: boolean;
  direction: 'forward' | 'reverse';
  startAnchorId: string;
}

export interface PathTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export interface PathParams {
  anchors: PathAnchor[];
  closed: boolean;
  fill: boolean;
  transform: PathTransform;
  animation: PathAnimation;
}

export interface PathGeneratorNode extends GroupedDeviceNode {
  id: string;
  kind: 'path';
  enabled: boolean;
  params: PathParams;
}

export type GeneratorNode =
  | RippleGeneratorNode
  | ScannerGeneratorNode
  | RainGeneratorNode
  | SpiralGeneratorNode
  | PathGeneratorNode;

export interface MirrorEffectNode extends GroupedDeviceNode {
  id: string;
  kind: 'mirror';
  enabled: boolean;
  params: {
    angleDeg: number;
  };
}

export interface SymmetryEffectNode extends GroupedDeviceNode {
  id: string;
  kind: 'symmetry';
  enabled: boolean;
  params: {
    mode: 'reflection' | 'rotation';
    sourceScope: 'sector' | 'entire';
    count: number;
    directionDeg: number;
    centerX: number;
    centerY: number;
  };
}

export interface ReverseEffectNode extends GroupedDeviceNode {
  id: string;
  kind: 'reverse';
  enabled: boolean;
}

export interface TimeWarpCurve {
  divisions: number;
  nodes: CurveNode[];
}

export interface TimeWarpEffectNode extends GroupedDeviceNode {
  id: string;
  kind: 'timewarp';
  enabled: boolean;
  params: {
    curve: TimeWarpCurve;
  };
}

export interface StretchEffectNode extends GroupedDeviceNode {
  id: string;
  kind: 'stretch';
  enabled: boolean;
  params: {
    start: number;
    end: number;
  };
}

export interface TrimEffectNode extends GroupedDeviceNode {
  id: string;
  kind: 'trim';
  enabled: boolean;
  params: {
    start: number;
    end: number;
  };
}

export type MaskMode = 'include' | 'exclude';
export type MaskSourceKind = 'tiles' | 'group' | 'generator';
export type MaskSourceDomain = 'scene' | 'activation';
export type MaskSourceVisibility = 'hide' | 'show';

export interface MaskEffectNode extends GroupedDeviceNode {
  id: string;
  kind: 'mask';
  enabled: boolean;
  params: {
    mode: MaskMode;
    tiles: number[];
    sourceKind: MaskSourceKind;
    sourceDomain: MaskSourceDomain;
    sourceId?: string | null;
    sourceVisibility: MaskSourceVisibility;
  };
}

export interface RotateEffectNode extends GroupedDeviceNode {
  id: string;
  kind: 'rotate';
  enabled: boolean;
  params: {
    angleDeg: number;
  };
}

export interface TranslateEffectNode extends GroupedDeviceNode {
  id: string;
  kind: 'translate';
  enabled: boolean;
  params: {
    offsetX: number;
    offsetY: number;
  };
}

export interface ScaleEffectNode extends GroupedDeviceNode {
  id: string;
  kind: 'scale';
  enabled: boolean;
  params: {
    centerX: number;
    centerY: number;
    scaleX: number;
    scaleY: number;
  };
}

export interface ColorEffectNode extends GroupedDeviceNode {
  id: string;
  kind: 'color';
  enabled: boolean;
  params: {
    velocities: number[];
    noteLengthPercent: number;
    gapPercent: number;
  };
}

export interface CurveNode {
  id: string;
  t: number;
  v: number;
  nextCurveBend?: number | null;
}

export interface ModulationCurve {
  domain: 'loop01';
  divisions: number;
  nodes: CurveNode[];
}

export interface ModulationTarget {
  id: string;
  slotIndex: number;
  deviceId: string;
  paramKey: string;
  amount: number;
}

export interface CurveModulatorNode extends GroupedDeviceNode {
  id: string;
  kind: 'modulator';
  enabled: boolean;
  params: {
    curve: ModulationCurve;
    targets: ModulationTarget[];
  };
}

export type GeneratorEffectNode =
  | MirrorEffectNode
  | MaskEffectNode
  | SymmetryEffectNode
  | ReverseEffectNode
  | TimeWarpEffectNode
  | TrimEffectNode
  | StretchEffectNode
  | RotateEffectNode
  | TranslateEffectNode
  | ScaleEffectNode
  | ColorEffectNode;

export type GeneratorDeviceNode =
  | GeneratorNode
  | GeneratorEffectNode
  | CurveModulatorNode;

export interface GroupStateEntry {
  enabled: boolean;
  name?: string | null;
  metadata?: AuthoredMetadata;
}

export interface GeneratorChain {
  name?: string | null;
  metadata?: AuthoredMetadata;
  devices: GeneratorDeviceNode[];
  groupStateById: Record<string, GroupStateEntry>;
}
