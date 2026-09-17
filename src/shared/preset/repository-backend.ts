import type { PresetBrowserTreeFolderNode, ReadPresetEntryResponse } from '../contracts/ipc/presets';
import type { PresetEntryCopyPlan } from './entry-copy';
import type { PresetEntryMovePlan } from './entry-move';
import type { PresetEntryPath, PresetEntrySelectionItem } from './entry-selection';
import type { PresetFile, PresetFileKind } from './file';

export interface PresetRepositoryStorage {
  location(entry: PresetEntryPath): Promise<string>;
  listOccupiedPaths(presetType: PresetFileKind): Promise<PresetEntryPath[]>;
  ensureEntry(entry: PresetEntrySelectionItem): Promise<void>;
  read<K extends PresetFileKind>(entry: PresetEntryPath & { presetType: K }): Promise<ReadPresetEntryResponse<K>>;
  createFolder(entry: PresetEntryPath): Promise<void>;
  rename(entry: PresetEntrySelectionItem, relativePath: string[]): Promise<void>;
  update(entry: PresetEntryPath, relativePath: string[], updatePayload: (payload: PresetFile) => PresetFile): Promise<void>;
  write(entry: PresetEntryPath, payload: PresetFile): Promise<void>;
  revision(entry: PresetEntryPath): Promise<string | null>;
  move(presetType: PresetFileKind, plans: readonly PresetEntryMovePlan[], destination: readonly string[], createDestination: boolean): Promise<void>;
  copy(presetType: PresetFileKind, plans: readonly PresetEntryCopyPlan[]): Promise<void>;
  delete(entries: readonly PresetEntrySelectionItem[]): Promise<void>;
}

export interface PresetRepositoryBackend {
  storage: PresetRepositoryStorage;
  listTree(): Promise<{ tree: PresetBrowserTreeFolderNode[]; occupiedPaths: PresetEntryPath[] }>;
  // Serialize planning and execution. Filesystem backends must also recheck targets
  // during execution: other programs can change files outside this queue.
  mutate<T>(operation: (storage: PresetRepositoryStorage) => Promise<T>): Promise<T>;
}
