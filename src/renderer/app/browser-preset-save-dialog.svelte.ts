import type { PresetFileKind } from '../../shared/preset/file';
import type { SavePresetFileResponse } from '../../shared/contracts/ipc/presets';

import type { PresetSaveResult } from '../../shared/preset/repository';

interface BrowserPresetSaveRequest {
  name: string;
  presetType: PresetFileKind;
  folder: string[];
  save: (name: string, folder: string[], approvedConflict: string | null) => Promise<PresetSaveResult>;
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
