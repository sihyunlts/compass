export interface WaterdropParams {
  centerX: number;
  centerY: number;
  curvature: number;
  startRadius: number;
}

export interface GroupedDeviceNode {
  groupId?: string | null;
  name?: string | null;
}

export interface WaterdropGeneratorNode extends GroupedDeviceNode {
  id: string;
  kind: 'waterdrop';
  enabled: boolean;
  params: WaterdropParams;
}

export interface ScannerParams {
  angleDeg: number;
  startOffset: number;
}

export interface ScannerGeneratorNode extends GroupedDeviceNode {
  id: string;
  kind: 'scanner';
  enabled: boolean;
  params: ScannerParams;
}

export interface SpiralParams {
  centerX: number;
  centerY: number;
  turns: number;
  startRadius: number;
}

export interface SpiralGeneratorNode extends GroupedDeviceNode {
  id: string;
  kind: 'spiral';
  enabled: boolean;
  params: SpiralParams;
}

export interface PathPoint {
  x: number;
  y: number;
}

export interface PathParams {
  points: PathPoint[];
  closed: boolean;
}

export interface PathGeneratorNode extends GroupedDeviceNode {
  id: string;
  kind: 'path';
  enabled: boolean;
  params: PathParams;
}

export type GeneratorNode =
  | WaterdropGeneratorNode
  | ScannerGeneratorNode
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
    mode: 'mirror-half' | 'quad-mirror' | 'quad-pinwheel';
    axis: 'horizontal' | 'vertical';
    sourceAnchor: 'bl' | 'br' | 'tr' | 'tl';
  };
}

export interface ReverseEffectNode extends GroupedDeviceNode {
  id: string;
  kind: 'reverse';
  enabled: boolean;
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
  deviceId: string;
  paramKey: string;
}

export interface CurveModulatorNode extends GroupedDeviceNode {
  id: string;
  kind: 'modulator';
  enabled: boolean;
  params: {
    amount: number;
    curve: ModulationCurve;
    target: ModulationTarget | null;
  };
}

export type GeneratorEffectNode =
  | MirrorEffectNode
  | MaskEffectNode
  | SymmetryEffectNode
  | ReverseEffectNode
  | RotateEffectNode
  | ColorEffectNode;

export type GeneratorDeviceNode =
  | GeneratorNode
  | GeneratorEffectNode
  | CurveModulatorNode;

export interface GroupStateEntry {
  enabled: boolean;
  name?: string | null;
}

export interface GeneratorChain {
  name?: string | null;
  devices: GeneratorDeviceNode[];
  groupStateById: Record<string, GroupStateEntry>;
}
