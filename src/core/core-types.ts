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

export interface TemporalMapping {
  alpha: number;
  beta: number;
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
  clipStack: SceneClip[];
}

export interface SceneInstanceBase {
  originId: string;
  spatial: AffineTransform;
  inverseSpatial: AffineTransform;
  sourceBounds: Bounds;
  temporal: TemporalMapping;
  clipStack: SceneClip[];
  velocity: number;
}

export interface WaterdropPrimitive {
  kind: 'waterdrop';
  params: WaterdropParams;
}

export interface ScannerPrimitive {
  kind: 'scanner';
  params: ScannerParams;
}

export interface SpiralPrimitive {
  kind: 'spiral';
  params: SpiralParams;
}

export type ScenePrimitive = WaterdropPrimitive | ScannerPrimitive | SpiralPrimitive;
export type ScenePrimitiveKind = ScenePrimitive['kind'];

interface WaterdropSceneInstance extends SceneInstanceBase {
  primitive: WaterdropPrimitive;
}

interface ScannerSceneInstance extends SceneInstanceBase {
  primitive: ScannerPrimitive;
}

interface SpiralSceneInstance extends SceneInstanceBase {
  primitive: SpiralPrimitive;
}

export type SceneInstance = WaterdropSceneInstance | ScannerSceneInstance | SpiralSceneInstance;
export type SceneInstanceOfKind<K extends ScenePrimitiveKind> = Extract<SceneInstance, { primitive: { kind: K } }>;
