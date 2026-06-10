export interface Vec2 {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface AffineTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export interface TemporalAffineRemap {
  kind: 'affine';
  alpha: number;
  beta: number;
}

export interface TemporalSampledRemap {
  kind: 'sampled';
  domainStart: number;
  domainEnd: number;
  samples: Array<number | null>;
}

export type TemporalRemap = TemporalAffineRemap | TemporalSampledRemap;

export interface TemporalVisibilityWindow {
  start: number;
  end: number;
}

export interface SceneTemporalState {
  /** Pending temporal transform relative to the current baked source timeline. */
  remap: TemporalRemap;
  /** Placement window that should be preserved when the pending transform is baked. */
  visibilityWindow: TemporalVisibilityWindow;
  /** True while authored placement is still pending and has not been baked into geometry. */
  hasAuthoredTimeline: boolean;
}

export interface TileUnionClipShape {
  kind: 'tile-union';
  tiles: ReadonlyArray<number>;
}

export interface HalfPlaneClipShape {
  kind: 'half-plane';
  point: Vec2;
  normal: Vec2;
}

export interface IntersectionClipShape {
  kind: 'intersection';
  shapes: ReadonlyArray<ClipShape>;
}

export type ClipShape = TileUnionClipShape | HalfPlaneClipShape | IntersectionClipShape;

export interface SceneClip {
  shape: ClipShape;
  inverseTransform: AffineTransform;
}

export interface Polyline {
  points: Vec2[];
  closed: boolean;
  originId: string;
  velocity: number;
  activationSignature?: string;
  activationStepBeats?: number;
  rasterMode?: 'centerline';
  colorSlotIndex?: number;
  colorSlotCount?: number;
  colorSlotGapFill?: boolean;
  clipStack: SceneClip[];
}
