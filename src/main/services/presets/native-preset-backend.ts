import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  PresetRepositoryBackend,
  PresetRepositoryStorage,
} from '../../../shared/preset/repository-backend';
import type { PresetEntryPath } from '../../../shared/preset/entry-selection';
import { PRESET_FILE_EXTENSIONS, type PresetFileKind } from '../../../shared/preset/file';
import { PresetBrowserTreeBuilder } from './preset-browser-tree';
import { resolvePresetPath } from './preset-paths';
import { PresetStorage } from './preset-storage';

export class NativePresetBackend implements PresetRepositoryBackend {
  public readonly storage: PresetRepositoryStorage;
  private readonly tree: PresetBrowserTreeBuilder;
  private queue: Promise<unknown> = Promise.resolve();

  public constructor(private readonly files: PresetStorage) {
    this.tree = new PresetBrowserTreeBuilder(files);
    const location = async (entry: PresetEntryPath): Promise<string> => {
      const result = resolvePresetPath(await files.resolvePresetDirectory(entry.presetType), entry.relativePath);
      if (!result) throw new Error('Invalid preset path.');
      return result;
    };
    this.storage = {
      location,
      listOccupiedPaths: (presetType) => this.tree.listOccupiedPaths(presetType),
      ensureEntry: async (entry) => files.ensurePresetEntryKind(await location(entry), entry.entryKind),
      read: async (entry) => files.readPresetFileByType(entry.presetType, await location(entry)),
      createFolder: async (entry) => { await files.createPresetFolder(entry.presetType, entry.relativePath.slice(0, -1), entry.relativePath.at(-1)!); },
      rename: async (entry, relativePath) => {
        if (entry.entryKind === 'file') await files.renamePresetFile(await location(entry), relativePath.at(-1)!, PRESET_FILE_EXTENSIONS[entry.presetType]);
        else await files.renamePresetFolder(entry.presetType, entry.relativePath, relativePath.at(-1)!);
      },
      update: async (entry, relativePath, updatePayload) => {
        await files.updatePresetFile(entry.presetType, await location(entry), relativePath.at(-1)!, PRESET_FILE_EXTENSIONS[entry.presetType], updatePayload);
      },
      write: async (entry, payload) => files.writePresetFile(await location(entry), payload),
      revision: async (entry) => {
        try { return await readFile(await location(entry), 'utf8'); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        }
      },
      move: async (presetType, plans, destination, createDestination) => { await files.movePresetEntries(presetType, plans, destination, createDestination); },
      copy: async (presetType, plans) => { await files.copyPresetEntries(presetType, plans); },
      delete: async (entries) => {
        await files.trashPresetEntries(await Promise.all(entries.map(async (entry) => ({ ...entry, filePath: await location(entry) }))));
      },
    };
  }

  public listTree() { return this.tree.listTree(); }

  public async entryAtPath(presetType: PresetFileKind, filePath: string): Promise<PresetEntryPath | null> {
    const root = await this.files.resolvePresetDirectory(presetType);
    const relative = path.relative(root, path.resolve(filePath));
    if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) return null;
    return { presetType, relativePath: relative.split(path.sep) };
  }

  public mutate<T>(operation: (storage: PresetRepositoryStorage) => Promise<T>): Promise<T> {
    const result = this.queue.then(() => operation(this.storage));
    this.queue = result.catch((): void => undefined);
    return result;
  }
}
