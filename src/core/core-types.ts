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

export interface TemporalSampledRemap {
  kind: 'sampled';
  domainStart: number;
  domainEnd: number;
  samples: Array<number | null>;
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
