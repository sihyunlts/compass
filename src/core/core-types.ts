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

export interface Polyline {
  readonly points: ReadonlyArray<Readonly<Vec2>>;
  readonly closed: boolean;
  readonly originId: string;
  readonly velocity: number;
  readonly colorAgeBandIndex?: number;
  readonly colorAgeBandCount?: number;
  readonly rasterMode?: 'centerline' | 'fill';
  readonly rasterTieBreakDirection?: Readonly<Vec2>;
}
