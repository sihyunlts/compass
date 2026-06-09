import type { RendererDeviceKind } from '../../devices';
import type {
  DevicePresetFile,
  GroupPresetFile,
  RackPresetFile,
} from '../../shared/presets';
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

export type BrowserInsertSource =
  | {
      kind: 'device-kind';
      deviceKind: RendererDeviceKind;
    }
  | {
      kind: 'device-preset';
      preset: DevicePresetFile;
    }
  | {
      kind: 'group-preset';
      preset: GroupPresetFile;
    }
  | {
      kind: 'rack-preset';
      preset: RackPresetFile;
      label: string;
      filePath?: string | null;
    };

export type BrowserPresetInsertSource = Exclude<BrowserInsertSource, { kind: 'device-kind' }>;
export type BrowserNonRackPresetInsertSource = Exclude<
  BrowserPresetInsertSource,
  { kind: 'rack-preset' }
>;

export type RackInteractionCommit =
  | {
      kind: 'move';
      sourceKind: ChainDragSourceKind;
      sourceIds: string[];
      dropZone: RackDropZone;
    }
  | {
      kind: 'insert-device';
      deviceKind: RendererDeviceKind;
      dropZone: RackDropZone;
    };
