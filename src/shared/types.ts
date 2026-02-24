type MessageKind = 'note' | 'cc';
type ButtonZone = 'grid' | 'left' | 'right' | 'top' | 'bottom' | 'logo';
export type LaunchpadModel = 'mk3' | 'mk2';

export interface MidiAddress {
  kind: MessageKind;
  number: number;
  channel: number;
}

export interface LaunchpadButton {
  id: string;
  zone: ButtonZone;
  x: number;
  y: number;
  output: MidiAddress;
}

export interface WaterdropParams {
  centerX: number;
  centerY: number;
  curvature: number;
  startRadius: number;
}

export interface GroupedDeviceNode {
  groupId?: string | null;
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

export type GeneratorNode =
  | WaterdropGeneratorNode
  | ScannerGeneratorNode
  | SpiralGeneratorNode;

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
export type MaskSourceVisibility = 'hide' | 'show';

export interface MaskEffectNode extends GroupedDeviceNode {
  id: string;
  kind: 'mask';
  enabled: boolean;
  params: {
    mode: MaskMode;
    tiles: number[];
    sourceKind: MaskSourceKind;
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

export interface CurveNode {
  id: string;
  t: number;
  v: number;
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
  | RotateEffectNode;

export type GeneratorDeviceNode =
  | GeneratorNode
  | GeneratorEffectNode
  | CurveModulatorNode;

export interface GroupStateEntry {
  enabled: boolean;
}

export interface GeneratorChain {
  devices: GeneratorDeviceNode[];
  groupStateById: Record<string, GroupStateEntry>;
}

export interface ClipNote {
  pitch: number;
  channel: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
}

export interface GeneratorPreview {
  noteCount: number;
  uniquePitchCount: number;
  notes: ClipNote[];
}

export interface BridgeSettings {
  autoCreateLengthBeats: number;
}

export interface BridgeTarget {
  host: string;
  port: number;
  path: string;
}

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

export interface LiveTempoUpdate {
  bpm: number;
  receivedAtIso: string;
  source: 'm4l-udp';
}

export interface PaletteFilePayload {
  name: string;
  content: string;
}

export interface PreviewWindowState {
  activeCells: Array<{
    pitch: number;
    rgb: string;
  }>;
  previewRevision: number;
  launchpadModel?: LaunchpadModel;
  chain: GeneratorChain;
  currentBeat: number;
  loopLengthBeats: number;
  noteCount: number;
  uniquePitchCount: number;
  bpm: number;
  isPlaying: boolean;
  isLoopEnabled: boolean;
  isGuideEnabled: boolean;
}

interface LiveBridgeBaseEnvelope {
  source: 'compass';
  layout: 'drum-rack';
  path: string;
}

export interface LiveBridgeNotesEnvelope extends LiveBridgeBaseEnvelope {
  event: 'clip_notes.replace';
  applyMode?: 'replace' | 'append';
  targetLengthBeats?: number;
  autoCreateLengthBeats?: number;
  notes: Array<{
    pitch: number;
    channel: number;
    startBeat: number;
    durationBeats: number;
    velocity: number;
    mute: boolean;
  }>;
}

export interface LiveBridgeTempoRequestEnvelope extends LiveBridgeBaseEnvelope {
  event: 'live_tempo.request';
}

export type LiveBridgeEnvelope =
  | LiveBridgeNotesEnvelope
  | LiveBridgeTempoRequestEnvelope;

export interface CompassApi {
  generateAndSend: (
    request: GenerateAndSendRequest,
  ) => Promise<GenerateAndSendResponse>;
  requestLiveTempo: () => Promise<RequestLiveTempoResponse>;
  openPreviewWindow: () => Promise<void>;
  pushPreviewWindowState: (state: PreviewWindowState) => void;
  requestPreviewWindowState: () => Promise<PreviewWindowState | null>;
  requestPreviewWindowVisibility: () => Promise<boolean>;
  requestPreviewGuideEnabledUpdate: (enabled: boolean) => Promise<void>;
  subscribePreviewWindowState: (
    listener: (state: PreviewWindowState) => void,
  ) => () => void;
  subscribePreviewWindowVisibility: (
    listener: (isOpen: boolean) => void,
  ) => () => void;
  subscribePreviewGuideEnabledUpdate: (
    listener: (enabled: boolean) => void,
  ) => () => void;
  subscribeLiveTempo: (
    listener: (update: LiveTempoUpdate) => void,
  ) => () => void;
}
