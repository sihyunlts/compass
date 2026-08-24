import path from 'node:path';

import { compareDeviceBrowserCategoryDirectoryNames } from '../../../devices/browser-categories';
import type {
  PresetBrowserTreeFolderNode,
  PresetBrowserTreeNode,
} from '../../../shared/contracts/ipc/presets';
import type { PresetEntryPath } from '../../../shared/preset-entry-selection';
import {
  resolvePresetBrowserPreview,
  type PresetFileKind,
} from '../../../shared/presets';
import { PRESET_FILE_SPECS, PRESET_ROOT_SECTION_LABELS } from './preset-config';
import { hasPresetExtension, resolvePresetPath } from './preset-paths';
import { PresetStorage } from './preset-storage';

const compareEntryNames = (left: string, right: string): number =>
  left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: 'base',
  });

const comparePresetDirectoryNames = (
  presetType: PresetFileKind,
  relativePath: readonly string[],
  left: string,
  right: string,
): number => {
  if (presetType === 'device' && relativePath.length === 0) {
    return compareDeviceBrowserCategoryDirectoryNames(left, right);
  }

  return compareEntryNames(left, right);
};

/** Builds the preset browser tree from on-disk preset folders. */
export class PresetBrowserTreeBuilder {
  private readonly storage: PresetStorage;

  public constructor(storage: PresetStorage) {
    this.storage = storage;
  }

  public async listTree(): Promise<{
    tree: PresetBrowserTreeFolderNode[];
    occupiedPaths: PresetEntryPath[];
  }> {
    const occupiedPaths: PresetEntryPath[] = [];
    const tree = await Promise.all(
      (['device', 'group', 'rack'] as const).map((presetType) =>
        this.buildRootNode(presetType, occupiedPaths)
      ),
    );
    return { tree, occupiedPaths };
  }

  public async listOccupiedPaths(
    presetType: PresetFileKind,
  ): Promise<PresetEntryPath[]> {
    const occupiedPaths: PresetEntryPath[] = [];
    await this.buildRootNode(presetType, occupiedPaths, false);
    return occupiedPaths;
  }

  private async buildRootNode(
    presetType: PresetFileKind,
    occupiedPaths: PresetEntryPath[],
    includeTree = true,
  ): Promise<PresetBrowserTreeFolderNode> {
    const rootDirectory = await this.storage.resolvePresetDirectory(presetType);
    return {
      kind: 'folder',
      id: `preset-root:${presetType}`,
      label: PRESET_ROOT_SECTION_LABELS[presetType],
      presetType,
      relativePath: [],
      children: await this.buildChildren(
        presetType,
        rootDirectory,
        [],
        occupiedPaths,
        includeTree,
      ),
    };
  }

  private async buildChildren(
    presetType: PresetFileKind,
    rootDirectory: string,
    relativePath: readonly string[],
    occupiedPaths: PresetEntryPath[],
    includeTree: boolean,
  ): Promise<PresetBrowserTreeNode[]> {
    const directoryPath = resolvePresetPath(rootDirectory, relativePath);
    if (!directoryPath) {
      return [];
    }

    const directoryEntries = await this.storage.readDirectoryEntries(directoryPath);
    const entries: PresetBrowserTreeNode[] = [];
    for (const entry of directoryEntries) {
      occupiedPaths.push({
        presetType,
        relativePath: [...relativePath, entry.name],
      });
    }

    const childDirectories = directoryEntries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) =>
        comparePresetDirectoryNames(
          presetType,
          relativePath,
          left.name,
          right.name,
        )
      );

    for (const directory of childDirectories) {
      const nextRelativePath = [...relativePath, directory.name];
      const children = await this.buildChildren(
        presetType,
        rootDirectory,
        nextRelativePath,
        occupiedPaths,
        includeTree,
      );
      if (includeTree) {
        entries.push({
          kind: 'folder',
          id: `preset:${presetType}:${nextRelativePath.join('/')}`,
          label: directory.name,
          presetType,
          relativePath: nextRelativePath,
          children,
        });
      }
    }

    if (!includeTree) {
      return [];
    }

    const fileEntries = directoryEntries
      .filter((entry) => entry.isFile())
      .filter((entry) =>
        hasPresetExtension(entry.name, PRESET_FILE_SPECS[presetType].extension))
      .sort((left, right) => compareEntryNames(left.name, right.name));

    for (const entry of fileEntries) {
      const nextRelativePath = [...relativePath, entry.name];
      const filePath = resolvePresetPath(rootDirectory, nextRelativePath);
      if (!filePath) {
        continue;
      }

      const readResult = await this.storage.readPresetFileByType(presetType, filePath);
      const leafNode = {
        kind: 'preset' as const,
        id: `preset:${presetType}:${nextRelativePath.join('/')}`,
        presetType,
        label: path.parse(entry.name).name,
        relativePath: nextRelativePath,
      };
      if (readResult.status === 'error') {
        entries.push({
          ...leafNode,
          loadStatus: 'error',
          loadErrorCode: readResult.errorCode,
        });
        continue;
      }
      const preview = resolvePresetBrowserPreview(readResult.payload);

      entries.push({
        ...leafNode,
        loadStatus: 'loaded',
        savedAtIso: readResult.payload.savedAtIso,
        ...(preview ? { preview } : {}),
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
