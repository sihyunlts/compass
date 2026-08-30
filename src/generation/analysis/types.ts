export interface BeatRange {
  start: number;
  end: number;
}

export interface SpatialBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export type SpatialRequirement = SpatialBounds | 'all' | 'none';
