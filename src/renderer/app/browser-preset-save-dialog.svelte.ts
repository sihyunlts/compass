import type { PresetFileKind } from '../../shared/presets';
import type { SavePresetFileResponse } from '../../shared/contracts/ipc/presets';

export type BrowserPresetSaveResult =
  | { status: 'saved'; filePath: string }
  | { status: 'conflict'; conflict: string }
  | { status: 'invalid-name' | 'missing-folder' | 'folder-conflict' };

interface BrowserPresetSaveRequest {
  name: string;
  presetType: PresetFileKind;
  folder: string[];
  save: (name: string, folder: string[], approvedConflict: string | null) => BrowserPresetSaveResult;
}

class BrowserPresetSaveDialog {
  request = $state<BrowserPresetSaveRequest | null>(null);
  private resolve: ((response: SavePresetFileResponse) => void) | null = null;

  show(request: BrowserPresetSaveRequest): Promise<SavePresetFileResponse> {
    if (this.request) {
      return Promise.resolve({ status: 'canceled' });
    }
    this.request = request;
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  close(response: SavePresetFileResponse = { status: 'canceled' }): void {
    const resolve = this.resolve;
    this.request = null;
    this.resolve = null;
    resolve?.(response);
  }
}

export const browserPresetSaveDialog = new BrowserPresetSaveDialog();
