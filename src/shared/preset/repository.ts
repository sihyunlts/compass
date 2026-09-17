import { PresetNameConflictError } from './operation-error';
import { isDeviceBrowserSystemDirectoryPath } from '../../devices/browser-categories';
import { readBundledRackPreset } from './bundled-racks';
import type {
  CopyPresetEntriesResponse,
  CreatePresetFolderResponse,
  DeletePresetEntriesResponse,
  ListPresetBrowserTreeResponse,
  MovePresetEntriesResponse,
  ReadPresetEntryResponse,
  RenamePresetFileResponse,
  RenamePresetFolderResponse,
  UpdatePresetFileInfoResponse,
} from '../contracts/ipc/presets';
import { preparePresetEntryCopy } from './entry-copy';
import { preparePresetEntryMove } from './entry-move';
import {
  arePresetPathsEqual,
  doPresetPathsCollide,
  normalizePresetEntrySelection,
  type PresetEntryPath,
} from './entry-selection';
import {
  ensurePresetExtension,
  hasPresetExtension,
  isValidPresetPathSegment,
  sanitizeFileStem,
} from './paths';
import type { PresetRepositoryBackend, PresetRepositoryStorage } from './repository-backend';
import {
  parseCopyPresetEntriesRequest,
  parseCreatePresetFolderRequest,
  parseDeletePresetEntriesRequest,
  parseMovePresetEntriesRequest,
  parseReadPresetEntryRequest,
  parseRenamePresetFileRequest,
  parseRenamePresetFolderRequest,
  parseUpdatePresetFileInfoRequest,
  parseSavePresetFileRequest,
} from './requests';
import {
  PRESET_FILE_EXTENSIONS,
  resolvePresetNameFromFileName,
  withPresetAuthoredMetadata,
  type PresetFile,
  type PresetFileKind,
} from './file';

export type PresetSaveResult =
  | { status: 'saved'; filePath: string }
  | { status: 'conflict'; conflict: string }
  | { status: 'invalid-name' | 'missing-folder' | 'folder-conflict' }
  | { status: 'error'; message: string };

const errorResult = (error: unknown) => ({
  status: 'error' as const,
  ...(error instanceof PresetNameConflictError ? { errorCode: error.code } : {}),
  message: error instanceof Error ? error.message : 'Preset operation failed.',
});

const requireRequest = <T>(request: T | null): T => {
  if (!request) throw new Error('Invalid preset request.');
  return request;
};

const ensureFileType = (entry: PresetEntryPath): void => {
  if (!hasPresetExtension(entry.relativePath.at(-1) ?? '', PRESET_FILE_EXTENSIONS[entry.presetType])) {
    throw new Error('Unsupported preset file extension.');
  }
};

const folderTarget = (entry: PresetEntryPath, folderName: string): string[] => {
  const name = folderName.trim();
  if (!isValidPresetPathSegment(name)) throw new Error('Invalid folder name.');
  const target = [...entry.relativePath, name];
  if (entry.presetType === 'device' && isDeviceBrowserSystemDirectoryPath(target)) {
    throw new Error('Built-in device folder names are reserved.');
  }
  return target;
};

/** Shared preset operations; platform adapters own persistence and native UI. */
export class PresetRepository {
  public constructor(private readonly backend: PresetRepositoryBackend) {}

  private async mutate<T>(operation: (storage: PresetRepositoryStorage) => Promise<T>): Promise<T | ReturnType<typeof errorResult>> {
    try { return await this.backend.mutate(operation); }
    catch (error) { return errorResult(error); }
  }

  private async ensureTargetAvailable(storage: PresetRepositoryStorage, entry: PresetEntryPath, relativePath: string[], excludeSource = false): Promise<void> {
    const occupied = await storage.listOccupiedPaths(entry.presetType);
    if (occupied.some((path) => doPresetPathsCollide(path.relativePath, relativePath)
      && !(excludeSource && arePresetPathsEqual(path.relativePath, entry.relativePath)))) {
      throw new PresetNameConflictError();
    }
  }

  private async fileTarget(storage: PresetRepositoryStorage, entry: PresetEntryPath, name: string): Promise<string[]> {
    ensureFileType(entry);
    await storage.ensureEntry({ ...entry, entryKind: 'file' });
    const fallback = resolvePresetNameFromFileName(entry.relativePath.at(-1) ?? '', entry.presetType) ?? 'Preset';
    const fileName = ensurePresetExtension(sanitizeFileStem(name, fallback), PRESET_FILE_EXTENSIONS[entry.presetType]);
    const relativePath = [...entry.relativePath.slice(0, -1), fileName];
    await this.ensureTargetAvailable(storage, entry, relativePath, true);
    return relativePath;
  }

  private async pathChange(storage: PresetRepositoryStorage, entry: PresetEntryPath, relativePath: string[]) {
    return { relativePath, sourcePath: await storage.location(entry),
      filePath: await storage.location({ ...entry, relativePath }) };
  }

  public async listPresetBrowserTree(): Promise<ListPresetBrowserTreeResponse> {
    try { return { status: 'ok', ...await this.backend.listTree() }; }
    catch (error) { return errorResult(error); }
  }

  public async readPresetEntry<K extends PresetFileKind = PresetFileKind>(request: unknown): Promise<ReadPresetEntryResponse<K>> {
    const entry = parseReadPresetEntryRequest(request);
    if (!entry) return { status: 'error', errorCode: 'invalid-read-request', message: 'Invalid file read request.' };
    if (entry.source === 'bundled') return readBundledRackPreset(entry.presetType as K, entry.relativePath);
    if (!hasPresetExtension(entry.relativePath.at(-1) ?? '', PRESET_FILE_EXTENSIONS[entry.presetType])) {
      return { status: 'error', errorCode: 'unsupported-file-extension', message: 'Unsupported file extension.' };
    }
    try { return await this.backend.storage.read({ ...entry, presetType: entry.presetType as K }); }
    catch (error) { return { ...errorResult(error), errorCode: 'file-read-failed' }; }
  }

  public async renamePresetFile(request: unknown): Promise<RenamePresetFileResponse> {
    return this.mutate(async (storage) => {
      const entry = requireRequest(parseRenamePresetFileRequest(request));
      const target = await this.fileTarget(storage, entry, entry.fileName);
      await storage.rename({ ...entry, entryKind: 'file' }, target);
      return { status: 'renamed' as const, ...await this.pathChange(storage, entry, target) };
    });
  }

  public async updatePresetFileInfo(request: unknown): Promise<UpdatePresetFileInfoResponse> {
    return this.mutate(async (storage) => {
      const entry = requireRequest(parseUpdatePresetFileInfoRequest(request));
      const target = await this.fileTarget(storage, entry, entry.fileName);
      const savedAtIso = new Date().toISOString();
      await storage.update(entry, target, (payload) => withPresetAuthoredMetadata(payload, entry.metadata, savedAtIso));
      return { status: 'updated' as const, ...await this.pathChange(storage, entry, target), savedAtIso };
    });
  }

  public async createPresetFolder(request: unknown): Promise<CreatePresetFolderResponse> {
    return this.mutate(async (storage) => {
      const entry = requireRequest(parseCreatePresetFolderRequest(request));
      const relativePath = folderTarget(entry, entry.folderName);
      await storage.ensureEntry({ ...entry, entryKind: 'directory' });
      await this.ensureTargetAvailable(storage, entry, relativePath);
      await storage.createFolder({ ...entry, relativePath });
      return { status: 'ok' as const, relativePath };
    });
  }

  public async renamePresetFolder(request: unknown): Promise<RenamePresetFolderResponse> {
    return this.mutate(async (storage) => {
      const entry = requireRequest(parseRenamePresetFolderRequest(request));
      if (entry.presetType === 'device' && isDeviceBrowserSystemDirectoryPath(entry.relativePath)) {
        throw new Error('Built-in device folders cannot be renamed.');
      }
      const target = folderTarget({ ...entry, relativePath: entry.relativePath.slice(0, -1) }, entry.folderName);
      await storage.ensureEntry({ ...entry, entryKind: 'directory' });
      await this.ensureTargetAvailable(storage, entry, target, true);
      await storage.rename({ ...entry, entryKind: 'directory' }, target);
      return { status: 'ok' as const, ...await this.pathChange(storage, entry, target) };
    });
  }

  public async deletePresetEntries(request: unknown): Promise<DeletePresetEntriesResponse> {
    return this.mutate(async (storage) => {
      const parsed = requireRequest(parseDeletePresetEntriesRequest(request));
      if (parsed.entries.some((entry) => entry.relativePath.length === 0)) throw new Error('Preset root folders cannot be deleted.');
      const entries = normalizePresetEntrySelection(parsed.entries);
      for (const entry of entries) {
        if (entry.entryKind === 'directory' && entry.presetType === 'device' && isDeviceBrowserSystemDirectoryPath(entry.relativePath)) {
          throw new Error('Built-in device folders cannot be deleted.');
        }
        if (entry.entryKind === 'file') ensureFileType(entry);
        await storage.ensureEntry(entry);
      }
      const deleted = await Promise.all(entries.map(async (entry) => ({ ...entry, filePath: await storage.location(entry) })));
      await storage.delete(entries);
      return { status: 'ok' as const, entries: deleted };
    });
  }

  public async movePresetEntries(request: unknown): Promise<MovePresetEntriesResponse> {
    return this.mutate(async (storage) => {
      const parsed = requireRequest(parseMovePresetEntriesRequest(request));
      const prepared = preparePresetEntryMove(parsed.entries, parsed.destination, await storage.listOccupiedPaths(parsed.destination.presetType));
      if (prepared.status === 'error') {
        if (prepared.errorCode === 'name-conflict') throw new PresetNameConflictError();
        throw new Error(prepared.message);
      }
      for (const { entry } of prepared.plans) {
        if (entry.entryKind === 'file') ensureFileType(entry);
      }
      await storage.move(prepared.presetType, prepared.plans, prepared.destinationRelativePath, prepared.createDestination);
      const entries = await Promise.all(prepared.plans.map(async ({ entry, relativePath }) => ({
        ...entry, ...await this.pathChange(storage, entry, relativePath),
      })));
      return { status: 'ok' as const, entries };
    });
  }

  public async copyPresetEntries(request: unknown): Promise<CopyPresetEntriesResponse> {
    return this.mutate(async (storage) => {
      const parsed = requireRequest(parseCopyPresetEntriesRequest(request));
      const presetType = parsed.entries[0].presetType;
      const prepared = preparePresetEntryCopy(parsed.entries, parsed.destination, await storage.listOccupiedPaths(presetType));
      if (prepared.status === 'error') throw new Error(prepared.message);
      await storage.copy(presetType, prepared.plans);
      return { status: 'ok' as const, entries: prepared.plans.map(({ entry, relativePath }) => ({ ...entry, relativePath })) };
    });
  }

  public async savePresetAt(entry: PresetEntryPath, payload: PresetFile, approval: 'overwrite' | { conflict: string | null }): Promise<PresetSaveResult> {
    return this.mutate(async (storage): Promise<PresetSaveResult> => {
      const request = requireRequest(parseSavePresetFileRequest({ suggestedName: '', payload }));
      const path = requireRequest(parseReadPresetEntryRequest({ ...entry, source: 'user' }));
      if (request.payload.presetType !== path.presetType) throw new Error('Invalid preset type.');
      if (!isValidPresetPathSegment(path.relativePath.at(-1) ?? '')) return { status: 'invalid-name' };
      ensureFileType(path);
      try { await storage.ensureEntry({ ...path, relativePath: path.relativePath.slice(0, -1), entryKind: 'directory' }); }
      catch { return { status: 'missing-folder' }; }
      const occupied = await storage.listOccupiedPaths(path.presetType);
      const existing = occupied.find((candidate) => doPresetPathsCollide(candidate.relativePath, path.relativePath));
      if (existing) {
        try { await storage.ensureEntry({ ...existing, entryKind: 'file' }); }
        catch { return { status: 'folder-conflict' }; }
      }
      const target = existing ?? path;
      if (approval !== 'overwrite') {
        const conflict = await storage.revision(target);
        if (conflict !== null && approval.conflict !== conflict) return { status: 'conflict', conflict };
      }
      await storage.write(target, request.payload);
      return { status: 'saved', filePath: await storage.location(target) };
    });
  }
}
