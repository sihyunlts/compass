import path from 'node:path';

import type {
  PresetBrowserTreeFolderNode,
  PresetBrowserTreeNode,
} from '../../../shared/contracts/ipc/presets';
import type { PresetFileKind } from '../../../shared/presets';
import { PRESET_FILE_SPECS, PRESET_ROOT_SECTION_LABELS } from './preset-config';
import { hasPresetExtension, resolvePresetPath } from './preset-paths';
import { PresetStorage } from './preset-storage';

const compareEntryNames = (left: string, right: string): number =>
  left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: 'base',
  });

/** Builds the preset browser tree from on-disk preset folders. */
export class PresetBrowserTreeBuilder {
  private readonly storage: PresetStorage;

  public constructor(storage: PresetStorage) {
    this.storage = storage;
  }

  public async listTree(): Promise<PresetBrowserTreeFolderNode[]> {
    return Promise.all(
      (['device', 'group', 'rack'] as const).map((presetType) =>
        this.buildRootNode(presetType)
      ),
    );
  }

  private async buildRootNode(
    presetType: PresetFileKind,
  ): Promise<PresetBrowserTreeFolderNode> {
    const rootDirectory = await this.storage.resolvePresetDirectory(presetType);
    return {
      kind: 'folder',
      id: `preset-root:${presetType}`,
      label: PRESET_ROOT_SECTION_LABELS[presetType],
      presetType,
      relativePath: [],
      children: await this.buildChildren(presetType, rootDirectory, []),
    };
  }

  private async buildChildren(
    presetType: PresetFileKind,
    rootDirectory: string,
    relativePath: readonly string[],
  ): Promise<PresetBrowserTreeNode[]> {
    const directoryPath = resolvePresetPath(rootDirectory, relativePath);
    if (!directoryPath) {
      return [];
    }

    const directoryEntries = await this.storage.readDirectoryEntries(directoryPath);
    const entries: PresetBrowserTreeNode[] = [];

    const childDirectories = directoryEntries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => compareEntryNames(left.name, right.name));

    for (const directory of childDirectories) {
      const nextRelativePath = [...relativePath, directory.name];
      entries.push({
        kind: 'folder',
        id: `preset:${presetType}:${nextRelativePath.join('/')}`,
        label: directory.name,
        presetType,
        relativePath: nextRelativePath,
        children: await this.buildChildren(
          presetType,
          rootDirectory,
          nextRelativePath,
        ),
      });
    }

    const fileEntries = directoryEntries
      .filter((entry) =>
        entry.isFile() && hasPresetExtension(entry.name, PRESET_FILE_SPECS[presetType].extension))
      .sort((left, right) => compareEntryNames(left.name, right.name));

    for (const entry of fileEntries) {
      const nextRelativePath = [...relativePath, entry.name];
      const filePath = resolvePresetPath(rootDirectory, nextRelativePath);
      if (!filePath) {
        continue;
      }

      const readResult = await this.storage.readPresetFileByType(presetType, filePath);
      if (readResult.status === 'error') {
        continue;
      }

      entries.push({
        kind: 'preset',
        id: `preset:${presetType}:${nextRelativePath.join('/')}`,
        presetType,
        label: path.parse(entry.name).name,
        relativePath: nextRelativePath,
        savedAtIso: readResult.payload.savedAtIso,
        ...(readResult.payload.presetType === 'device'
          ? {
              deviceKind: readResult.payload.device.kind,
            }
          : {}),
      });
    }

    return entries;
  }
}
