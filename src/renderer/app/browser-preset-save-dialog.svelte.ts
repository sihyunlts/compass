import type { PresetFileKind } from '../../shared/preset/file';
import type { SavePresetFileResponse } from '../../shared/contracts/ipc/presets';

import type { PresetSaveResult } from '../../shared/preset/repository';
import type { PresetRepository } from '../../shared/preset/repository';
import type { SavePresetFileRequest } from '../../shared/contracts/ipc/presets';
import { getRendererDeviceLabel } from '../../devices/registry-core';
import { getDeviceBrowserCategoryDirectoryName } from '../../devices/browser-categories';
import { PRESET_FILE_EXTENSIONS } from '../../shared/preset/file';
import { ensurePresetExtension, isValidPresetPathSegment, sanitizeFileStem } from '../../shared/preset/paths';

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

export const createBrowserPresetSaveHandler = (savePresetAt: PresetRepository['savePresetAt']) =>
  async (requestOrFactory: SavePresetFileRequest | (() => SavePresetFileRequest)): Promise<SavePresetFileResponse> => {
    const buildRequest = typeof requestOrFactory === 'function' ? requestOrFactory : () => requestOrFactory;
    const request = buildRequest();
    const presetType = request.payload.presetType;
    const folder = request.payload.presetType === 'device'
      ? [getDeviceBrowserCategoryDirectoryName(request.payload.device.kind), getRendererDeviceLabel(request.payload.device.kind)] : [];
    const defaultNames = { device: 'Device', group: 'Group', rack: 'Rack' };
    return browserPresetSaveDialog.show({
      name: sanitizeFileStem(request.suggestedName, defaultNames[presetType]),
      presetType,
      folder,
      save: async (name, folder, approvedConflict) => {
        if (!isValidPresetPathSegment(name)) return { status: 'invalid-name' };
        return savePresetAt({ presetType,
          relativePath: [...folder, ensurePresetExtension(name.trim(), PRESET_FILE_EXTENSIONS[presetType])] },
        buildRequest().payload, { conflict: approvedConflict });
      },
    });
  };
