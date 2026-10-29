import type { Bounds } from '../../../core/core-types';
import type { BezierHandleKind as HandleKind } from '../../../shared/bezier-handles';
import type { PathAnchor, PathTransform } from '../../../shared/model';
import type { RendererControlChange } from '../../../devices/control-types';

export type EditorPoint = { x: number; y: number };
export type SnappedEditorPoint = {
  point: EditorPoint;
  snapSignature: string | null;
};
export type AlignmentGuides = { x: number | null; y: number | null };
export type AxisSnap = { value: number; target: number | null };
export type Selection =
  | { kind: 'anchors'; anchorIds: string[] }
  | { kind: 'path' }
  | null;
export type DragTarget =
  | { kind: 'anchor'; anchorId: string }
  | { kind: 'anchor-handle'; anchorId: string }
  | { kind: 'handle'; anchorId: string; handleKind: HandleKind }
  | {
    kind: 'anchors-move';
    anchorIds: string[];
    startPoint: EditorPoint;
    startAnchors: PathAnchor[];
  }
  | {
    kind: 'path-move';
    startPoint: EditorPoint;
    startTransform: PathTransform;
    startBounds: Bounds;
  }
  | {
    kind: 'path-rotate';
    center: EditorPoint;
    startAngle: number;
    startRotationRadians: number;
    startTransform: PathTransform;
  }
  | {
    kind: 'path-scale';
    fixedPoint: EditorPoint;
    startVector: EditorPoint;
    startTransform: PathTransform;
    pointerOffset: EditorPoint;
  }
  | {
    kind: 'marquee';
    startPoint: EditorPoint;
    currentPoint: EditorPoint;
    additiveAnchorIds: string[];
  }
  | null;

export interface PathEditorProps {
  deviceId: string;
  anchors: PathAnchor[];
  closed: boolean;
  fill?: boolean;
  transform?: PathTransform;
  readonly?: boolean;
  previewProgress01?: number | null;
  previewDirection?: 'forward' | 'reverse';
  previewStartAnchorId?: string;
  selectedAnchorId?: string | null;
  onAnchorSelect?: (anchorId: string) => void;
  onControlChange: (change: RendererControlChange) => void;
}

export type PathEditorInput = Readonly<Required<Omit<PathEditorProps, 'fill' | 'onAnchorSelect'>>>;
