import {
  app,
  dialog,
  shell,
  type BaseWindow,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';
import type { Dirent } from 'node:fs';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getRendererDeviceLabel } from '../../devices/schema-registry';
import type {
  ListPresetBrowserTreeResponse,
  OpenPresetFileRequest,
  OpenPresetFileResponse,
  PresetBrowserTreeFolderNode,
  PresetBrowserTreeNode,
  ReadPresetEntryRequest,
  ReadPresetEntryResponse,
  SavePresetFileRequest,
  SavePresetFileResponse,
  ShowPresetEntryInFolderRequest,
  ShowPresetEntryInFolderResponse,
  ShowPresetsRootInFolderResponse,
} from '../../shared/contracts/ipc/presets';
import {
  isPresetFileKind,
  parsePresetFile,
  parsePresetFileText,
  PRESET_FILE_EXTENSIONS,
  type PresetFile,
  type PresetFileKind,
} from '../../shared/presets';

const PRESET_ROOT_DIR_NAME = 'Presets';

const PRESET_FILE_SPECS = {
  device: {
    directory: 'Devices',
    extension: PRESET_FILE_EXTENSIONS.device,
    filterName: 'Compass Device Presets',
    defaultName: 'Device Preset',
  },
  group: {
    directory: 'Groups',
    extension: PRESET_FILE_EXTENSIONS.group,
    filterName: 'Compass Group Presets',
    defaultName: 'Group Preset',
  },
  rack: {
    directory: 'Racks',
    extension: PRESET_FILE_EXTENSIONS.rack,
    filterName: 'Compass Rack Presets',
    defaultName: 'Rack Preset',
  },
} as const satisfies Record<
  PresetFileKind,
  {
    directory: string;
    extension: string;
    filterName: string;
    defaultName: string;
  }
>;

const PRESET_ROOT_SECTION_LABELS: Record<PresetFileKind, string> = {
  device: 'Devices',
  group: 'Groups',
  rack: 'Racks',
};

const sanitizeFileStem = (value: string, fallback: string): string => {
  const trimmed = value.trim();
  const sanitized = trimmed
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || fallback;
};

const resolvePresetSaveDirectory = (
  baseDirectory: string,
  request: SavePresetFileRequest,
): string => {
  if (request.payload.presetType !== 'device') {
    return baseDirectory;
  }

  const deviceDirectoryName = sanitizeFileStem(
    getRendererDeviceLabel(request.payload.device.kind),
    'Device',
  );
  return path.join(baseDirectory, deviceDirectoryName);
};

const hasPresetExtension = (
  filePath: string,
  extension: string,
): boolean => filePath.toLowerCase().endsWith(extension);

const ensurePresetExtension = (
  filePath: string,
  extension: string,
): string => {
  if (hasPresetExtension(filePath, extension)) {
    return filePath;
  }

  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${extension}`);
};

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallback;
};

const resolveDialogOptions = (
  presetType: PresetFileKind,
  defaultPath: string,
) => {
  const spec = PRESET_FILE_SPECS[presetType];
  const extension = spec.extension.slice(1);
  return {
    defaultPath,
    filters: [
      { name: spec.filterName, extensions: [extension] },
      { name: 'All Files', extensions: ['*'] },
    ],
  };
};

const parseSavePresetFileRequest = (
  value: unknown,
): SavePresetFileRequest | null => {
  if (
    typeof value !== 'object'
    || value === null
    || typeof (value as { suggestedName?: unknown }).suggestedName !== 'string'
  ) {
    return null;
  }

  const payload = parsePresetFile((value as { payload?: unknown }).payload, {
    mode: 'strict',
  });
  if (!payload) {
    return null;
  }

  return {
    suggestedName: (value as { suggestedName: string }).suggestedName,
    payload: payload.preset,
  };
};

const parseOpenPresetFileRequest = (
  value: unknown,
): OpenPresetFileRequest | null =>
  typeof value === 'object'
  && value !== null
  && isPresetFileKind((value as { presetType?: unknown }).presetType)
    ? { presetType: (value as { presetType: PresetFileKind }).presetType }
    : null;

const isValidRelativePathSegment = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length > 0
  && value !== '.'
  && value !== '..'
  && !value.includes('/')
  && !value.includes('\\');

const parseRelativePath = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || !value.every((segment) => isValidRelativePathSegment(segment))) {
    return null;
  }

  return [...value];
};

const parseReadPresetEntryRequest = (
  value: unknown,
): ReadPresetEntryRequest | null => {
  if (
    typeof value !== 'object'
    || value === null
    || !isPresetFileKind((value as { presetType?: unknown }).presetType)
  ) {
    return null;
  }

  const relativePath = parseRelativePath((value as { relativePath?: unknown }).relativePath);
  if (!relativePath || relativePath.length === 0) {
    return null;
  }

  return {
    presetType: (value as { presetType: PresetFileKind }).presetType,
    relativePath,
  };
};

const parseShowPresetEntryInFolderRequest = (
  value: unknown,
): ShowPresetEntryInFolderRequest | null => {
  if (
    typeof value !== 'object'
    || value === null
    || !isPresetFileKind((value as { presetType?: unknown }).presetType)
  ) {
    return null;
  }

  const relativePath = parseRelativePath((value as { relativePath?: unknown }).relativePath);
  const entryKind = (value as { entryKind?: unknown }).entryKind;
  if (!relativePath || (entryKind !== 'file' && entryKind !== 'directory')) {
    return null;
  }

  return {
    presetType: (value as { presetType: PresetFileKind }).presetType,
    relativePath,
    entryKind,
  };
};

const resolvePresetPath = (
  rootDirectory: string,
  relativePath: readonly string[],
): string | null => {
  const resolvedRoot = path.resolve(rootDirectory);
  const resolvedPath = path.resolve(rootDirectory, ...relativePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    return null;
  }

  return resolvedPath;
};

const compareEntryNames = (left: string, right: string): number =>
  left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: 'base',
  });

/** Handles preset file dialogs and JSON serialization for preset payloads. */
export class PresetService {
  private async resolvePresetsRootDirectory(): Promise<string> {
    const directory = path.join(
      app.getPath('userData'),
      PRESET_ROOT_DIR_NAME,
    );
    await mkdir(directory, { recursive: true });
    return directory;
  }

  private async resolvePresetDirectory(
    presetType: PresetFileKind,
  ): Promise<string> {
    const spec = PRESET_FILE_SPECS[presetType];
    const directory = path.join(
      await this.resolvePresetsRootDirectory(),
      spec.directory,
    );
    await mkdir(directory, { recursive: true });
    return directory;
  }

  private async readPresetFileByType<K extends PresetFileKind>(
    presetType: K,
    filePath: string,
  ): Promise<ReadPresetEntryResponse<K>> {
    try {
      const text = await readFile(filePath, 'utf8');
      const parsed = parsePresetFileText(text, {
        fileName: filePath,
        mode: 'recover',
      });
      if (parsed.ok === false) {
        return {
          status: 'error',
          message: parsed.message,
          filePath,
        };
      }
      if (parsed.preset.presetType !== presetType) {
        return {
          status: 'error',
          message: `Expected a ${presetType} preset file.`,
          filePath,
        };
      }

      return {
        status: 'loaded',
        filePath,
        payload: parsed.preset as Extract<PresetFile, { presetType: K }>,
        warning: parsed.warning,
      };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to read preset file.'),
        filePath,
      };
    }
  }

  private async readDirectoryEntries(
    directoryPath: string,
  ): Promise<Dirent<string>[]> {
    try {
      return await readdir(directoryPath, {
        encoding: 'utf8',
        withFileTypes: true,
      }) as Dirent<string>[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  private async buildPresetBrowserTreeChildren(
    presetType: PresetFileKind,
    rootDirectory: string,
    relativePath: readonly string[],
  ): Promise<PresetBrowserTreeNode[]> {
    const directoryPath = resolvePresetPath(rootDirectory, relativePath);
    if (!directoryPath) {
      return [];
    }

    const spec = PRESET_FILE_SPECS[presetType];
    const directoryEntries = await this.readDirectoryEntries(directoryPath);
    const entries: PresetBrowserTreeNode[] = [];

    const childDirectories = directoryEntries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => compareEntryNames(left.name, right.name));

    for (const directory of childDirectories) {
      const nextRelativePath = [...relativePath, directory.name];
      const children = await this.buildPresetBrowserTreeChildren(
        presetType,
        rootDirectory,
        nextRelativePath,
      );
      if (children.length === 0) {
        continue;
      }

      entries.push({
        kind: 'folder',
        id: `preset:${presetType}:${nextRelativePath.join('/')}`,
        label: directory.name,
        presetType,
        relativePath: nextRelativePath,
        children,
      });
    }

    const fileEntries = directoryEntries
      .filter((entry) => entry.isFile() && hasPresetExtension(entry.name, spec.extension))
      .sort((left, right) => compareEntryNames(left.name, right.name));

    for (const entry of fileEntries) {
      const nextRelativePath = [...relativePath, entry.name];
      const filePath = resolvePresetPath(rootDirectory, nextRelativePath);
      if (!filePath) {
        continue;
      }

      const readResult = await this.readPresetFileByType(presetType, filePath);
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
      });
    }

    return entries;
  }

  private async buildPresetBrowserRootNode(
    presetType: PresetFileKind,
  ): Promise<PresetBrowserTreeFolderNode> {
    const rootDirectory = await this.resolvePresetDirectory(presetType);
    return {
      kind: 'folder',
      id: `preset-root:${presetType}`,
      label: PRESET_ROOT_SECTION_LABELS[presetType],
      presetType,
      relativePath: [],
      children: await this.buildPresetBrowserTreeChildren(
        presetType,
        rootDirectory,
        [],
      ),
    };
  }

  public async savePresetFile(
    request: unknown,
    parentWindow?: BaseWindow,
  ): Promise<SavePresetFileResponse> {
    const parsedRequest = parseSavePresetFileRequest(request);
    if (!parsedRequest) {
      return {
        status: 'error',
        message: 'Invalid preset save request.',
      };
    }

    try {
      const presetType = parsedRequest.payload.presetType;
      const spec = PRESET_FILE_SPECS[presetType];
      const baseDirectory = await this.resolvePresetDirectory(presetType);
      const directory = resolvePresetSaveDirectory(baseDirectory, parsedRequest);
      await mkdir(directory, { recursive: true });
      const suggestedFileName = `${sanitizeFileStem(
        parsedRequest.suggestedName,
        spec.defaultName,
      )}${spec.extension}`;
      const dialogOptions: SaveDialogOptions = {
        ...resolveDialogOptions(
          presetType,
          path.join(directory, suggestedFileName),
        ),
        buttonLabel: 'Save',
        properties: ['createDirectory'],
        title: `Save ${spec.defaultName}`,
      };

      const result = parentWindow
        ? await dialog.showSaveDialog(parentWindow, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions);
      if (result.canceled || !result.filePath) {
        return { status: 'canceled' };
      }

      const filePath = ensurePresetExtension(result.filePath, spec.extension);
      await writeFile(
        filePath,
        `${JSON.stringify(parsedRequest.payload, null, 2)}\n`,
        'utf8',
      );
      return {
        status: 'saved',
        filePath,
      };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to save preset file.'),
      };
    }
  }

  public async openPresetFile(
    request: unknown,
    parentWindow?: BaseWindow,
  ): Promise<OpenPresetFileResponse> {
    const parsedRequest = parseOpenPresetFileRequest(request);
    if (!parsedRequest) {
      return {
        status: 'error',
        message: 'Invalid preset open request.',
      };
    }

    try {
      const spec = PRESET_FILE_SPECS[parsedRequest.presetType];
      const directory = await this.resolvePresetDirectory(parsedRequest.presetType);
      const dialogOptions: OpenDialogOptions = {
        ...resolveDialogOptions(parsedRequest.presetType, directory),
        buttonLabel: 'Open',
        properties: ['openFile'],
        title: `Open ${spec.defaultName}`,
      };

      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      const filePath = result.filePaths[0] ?? '';
      if (result.canceled || !filePath) {
        return { status: 'canceled' };
      }

      const readResult = await this.readPresetFileByType(parsedRequest.presetType, filePath);
      if (readResult.status === 'error') {
        return readResult;
      }

      return {
        status: 'opened',
        filePath: readResult.filePath,
        payload: readResult.payload,
        warning: readResult.warning,
      };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to read preset file.'),
      };
    }
  }

  public async listPresetBrowserTree(): Promise<ListPresetBrowserTreeResponse> {
    try {
      return {
        status: 'ok',
        tree: (
          await Promise.all(
            (['device', 'group', 'rack'] as const).map((presetType) =>
              this.buildPresetBrowserRootNode(presetType)
            ),
          )
        ).filter((node) => node.children.length > 0),
      };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to list preset browser tree.'),
      };
    }
  }

  public async readPresetEntry(
    request: unknown,
  ): Promise<ReadPresetEntryResponse> {
    const parsedRequest = parseReadPresetEntryRequest(request);
    if (!parsedRequest) {
      return {
        status: 'error',
        message: 'Invalid preset read request.',
      };
    }

    const rootDirectory = await this.resolvePresetDirectory(parsedRequest.presetType);
    const filePath = resolvePresetPath(rootDirectory, parsedRequest.relativePath);
    if (!filePath) {
      return {
        status: 'error',
        message: 'Invalid preset file path.',
      };
    }

    if (!hasPresetExtension(filePath, PRESET_FILE_SPECS[parsedRequest.presetType].extension)) {
      return {
        status: 'error',
        message: 'Unsupported preset file extension.',
        filePath,
      };
    }

    return this.readPresetFileByType(parsedRequest.presetType, filePath);
  }

  public async showPresetEntryInFolder(
    request: unknown,
  ): Promise<ShowPresetEntryInFolderResponse> {
    const parsedRequest = parseShowPresetEntryInFolderRequest(request);
    if (!parsedRequest) {
      return {
        status: 'error',
        message: 'Invalid preset entry request.',
      };
    }

    try {
      const rootDirectory = await this.resolvePresetDirectory(parsedRequest.presetType);
      const filePath = resolvePresetPath(rootDirectory, parsedRequest.relativePath);
      if (!filePath) {
        return {
          status: 'error',
          message: 'Invalid preset file path.',
        };
      }

      if (
        parsedRequest.entryKind === 'file'
        && !hasPresetExtension(filePath, PRESET_FILE_SPECS[parsedRequest.presetType].extension)
      ) {
        return {
          status: 'error',
          message: 'Invalid preset file type.',
        };
      }

      await access(filePath);
      if (parsedRequest.entryKind === 'directory') {
        const openError = await shell.openPath(filePath);
        if (openError) {
          return {
            status: 'error',
            message: openError,
          };
        }
      } else {
        shell.showItemInFolder(filePath);
      }

      return { status: 'ok' };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to reveal preset file.'),
      };
    }
  }

  public async showPresetsRootInFolder(): Promise<ShowPresetsRootInFolderResponse> {
    try {
      const directory = await this.resolvePresetsRootDirectory();
      const openError = await shell.openPath(directory);
      if (openError) {
        return {
          status: 'error',
          message: openError,
        };
      }

      return { status: 'ok' };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to reveal presets folder.'),
      };
    }
  }
}
