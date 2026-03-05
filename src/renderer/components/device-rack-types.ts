import type { BrowserDeviceKind } from '../services/devices';
import type {
  ChainDragSourceKind,
  RackDropZone,
} from '../state/rack-drop';

export interface RackScrollMetrics {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
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
      sourceKind: BrowserDeviceKind;
      dropZone: RackDropZone;
    };
