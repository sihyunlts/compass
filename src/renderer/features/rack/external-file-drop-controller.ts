import type { RackPresetFileDrop } from '../../components/rack/device-rack-types';
import type { RackDropZone } from './drop-ops';

interface ExternalFileDropControllerOptions {
  closeContextMenu: () => void;
  clearDropIndicator: () => void;
  syncDropIndicator: (clientX: number, clientY: number) => RackDropZone | null;
  onPresetFileDrop: (payload: RackPresetFileDrop) => void | Promise<void>;
}

const isFileDragEvent = (event: DragEvent): boolean =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files');

/** Tracks external file drag depth and maps browser file drops into rack payloads. */
class ExternalFileDropController {
  private readonly options: ExternalFileDropControllerOptions;

  private dragDepth = 0;

  public constructor(options: ExternalFileDropControllerOptions) {
    this.options = options;
  }

  public handleDragStart(event: DragEvent): void {
    event.preventDefault();
  }

  public handleDragEnter(event: DragEvent): void {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    const isInitialEnter = this.dragDepth === 0;
    this.dragDepth += 1;
    if (isInitialEnter) {
      this.options.closeContextMenu();
    }
    this.options.syncDropIndicator(event.clientX, event.clientY);
  }

  public handleDragOver(event: DragEvent): void {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    this.options.syncDropIndicator(event.clientX, event.clientY);
  }

  public handleDragLeave(event: DragEvent): void {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) {
      this.options.clearDropIndicator();
    }
  }

  public async handleDrop(event: DragEvent): Promise<void> {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    this.options.closeContextMenu();

    const files = Array.from(event.dataTransfer?.files ?? []);
    const file = files[0] ?? null;
    const dropZone = this.options.syncDropIndicator(event.clientX, event.clientY);
    this.dragDepth = 0;
    this.options.clearDropIndicator();

    if (!file) {
      return;
    }

    await this.options.onPresetFileDrop({
      file,
      fileCount: files.length,
      dropZone,
    });
  }
}

export const createExternalFileDropController = (
  options: ExternalFileDropControllerOptions,
) => new ExternalFileDropController(options);
