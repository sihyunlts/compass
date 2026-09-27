import { PresetNameConflictError } from '../../../shared/preset/operation-error';
import type { AuthoredMetadata } from '../../../shared/model';
import { withPresetAuthoredMetadata, type PresetFile, type PresetFileKind } from '../../../shared/preset/file';
import type { PresetRepository } from '../../../shared/preset/repository';
import type { NativePresetBackend } from './native-preset-backend';
import type { PresetStorage } from './preset-storage';
import { PRESET_FILE_SPECS } from './preset-config';

/** Saves library entries through the repository and chosen external files through storage. */
export class PresetFileOperations {
  public constructor(
    private readonly storage: PresetStorage,
    private readonly backend: NativePresetBackend,
    private readonly repository: PresetRepository,
  ) {}

  public async saveAtPath(filePath: string, payload: PresetFile): Promise<string> {
    const entry = await this.backend.entryAtPath(payload.presetType, filePath);
    if (!entry) {
      await this.storage.writePresetFile(filePath, payload);
      return filePath;
    }
    const result = await this.repository.savePresetAt(entry, payload, 'overwrite');
    if (result.status !== 'saved') {
      throw new Error(result.status === 'error' ? result.message : 'Preset could not be saved at that location.');
    }
    return result.filePath;
  }

  public async updatePresetInfoAtPath(
    presetType: PresetFileKind,
    filePath: string,
    fileName: string,
    metadata: AuthoredMetadata | undefined,
  ): Promise<{ filePath: string; savedAtIso: string }> {
    const entry = await this.backend.entryAtPath(presetType, filePath);
    if (entry) {
      const result = await this.repository.updatePresetFileInfo({ ...entry, source: 'user', fileName, metadata });
      if (result.status === 'error') {
        if (result.errorCode === 'name-conflict') throw new PresetNameConflictError();
        throw new Error(result.message);
      }
      return { filePath: result.filePath, savedAtIso: result.savedAtIso };
    }
    const savedAtIso = new Date().toISOString();
    const updatedPath = await this.storage.updatePresetFile(
      presetType,
      filePath,
      fileName,
      PRESET_FILE_SPECS[presetType].extension,
      (payload) => withPresetAuthoredMetadata(
        payload,
        metadata,
        savedAtIso,
      ),
    );
    return {
      filePath: updatedPath,
      savedAtIso,
    };
  }
}
