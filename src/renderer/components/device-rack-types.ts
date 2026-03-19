import type { RendererDeviceKind } from '../../devices';
import type {
  ChainDragSourceKind,
  RackDropZone,
} from '../features/rack/drop-ops';

export interface RackScrollMetrics {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

export interface RackPresetFileDrop {
  file: File;
  fileCount: number;
  dropZone: RackDropZone | null;
}

export type RackInteractionCommit =
  | {
      kind: 'move';
      sourceKind: ChainDragSourceKind;
      sourceIds: string[];
      dropZone: RackDropZone;
    }
  | {
      kind: 'insert';
      sourceKind: RendererDeviceKind;
      dropZone: RackDropZone;
    };
