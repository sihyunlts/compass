import type { ScannerParams, SpiralParams, WaterdropParams } from '../shared/model';

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

interface TemporalTransform {
  alpha: number;
  beta: number;
}

export type Mask = (x: number, y: number) => boolean;

export interface Polyline {
  points: Vec2[];
  closed: boolean;
  originId: string;
  velocity: number;
  mask?: Mask;
}

export interface GeneratorLayerBase {
  originId: string;
  spatial: AffineTransform;
  inverseSpatial: AffineTransform;
  sourceBounds: Bounds;
  temporal: TemporalTransform;
  mask?: Mask;
  velocity: number;
}

interface WaterdropLayer extends GeneratorLayerBase {
  kind: 'waterdrop';
  params: WaterdropParams;
}

interface ScannerLayer extends GeneratorLayerBase {
  kind: 'scanner';
  params: ScannerParams;
}

interface SpiralLayer extends GeneratorLayerBase {
  kind: 'spiral';
  params: SpiralParams;
}

export type GeneratorLayer = WaterdropLayer | ScannerLayer | SpiralLayer;
