import {
  app,
  dialog,
  type BaseWindow,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';
import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getRendererDeviceLabel } from '../../devices/schema-registry';
import type {
  ListPresetBrowserSectionsResponse,
  OpenPresetFileRequest,
  OpenPresetFileResponse,
  PresetBrowserFileItem,
  PresetBrowserSection,
  ReadPresetEntryRequest,
  ReadPresetEntryResponse,
  SavePresetFileRequest,
  SavePresetFileResponse,
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
  private async resolvePresetDirectory(
    presetType: PresetFileKind,
  ): Promise<string> {
    const spec = PRESET_FILE_SPECS[presetType];
    const directory = path.join(
      app.getPath('userData'),
      PRESET_ROOT_DIR_NAME,
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

  private async collectPresetSectionEntries(
    presetType: PresetFileKind,
    rootDirectory: string,
    relativePath: readonly string[],
    labelPrefix = '',
  ): Promise<PresetBrowserFileItem[]> {
    const directoryPath = resolvePresetPath(rootDirectory, relativePath);
    if (!directoryPath) {
      return [];
    }

    const spec = PRESET_FILE_SPECS[presetType];
    const directoryEntries = await this.readDirectoryEntries(directoryPath);
    const entries: PresetBrowserFileItem[] = [];

    const fileEntries = directoryEntries
      .filter((entry) => entry.isFile() && hasPresetExtension(entry.name, spec.extension))
      .sort((left, right) => compareEntryNames(left.name, right.name));

    for (const entry of fileEntries) {
      entries.push({
        presetType,
        name: labelPrefix ? `${labelPrefix} / ${path.parse(entry.name).name}` : path.parse(entry.name).name,
        relativePath: [...relativePath, entry.name],
      });
    }

    const childDirectories = directoryEntries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => compareEntryNames(left.name, right.name));

    for (const directory of childDirectories) {
      const nextPrefix = labelPrefix ? `${labelPrefix} / ${directory.name}` : directory.name;
      entries.push(
        ...(await this.collectPresetSectionEntries(
          presetType,
          rootDirectory,
          [...relativePath, directory.name],
          nextPrefix,
        )),
      );
    }

    return entries;
  }

  private async listPresetBrowserSectionsByType(
    presetType: PresetFileKind,
  ): Promise<PresetBrowserSection[]> {
    const rootDirectory = await this.resolvePresetDirectory(presetType);
    const rootEntries = await this.readDirectoryEntries(rootDirectory);
    const spec = PRESET_FILE_SPECS[presetType];
    const sections: PresetBrowserSection[] = [];

    const rootFiles = rootEntries
      .filter((entry) => entry.isFile() && hasPresetExtension(entry.name, spec.extension))
      .sort((left, right) => compareEntryNames(left.name, right.name))
      .map<PresetBrowserFileItem>((entry) => ({
        presetType,
        name: path.parse(entry.name).name,
        relativePath: [entry.name],
      }));

    const rootDirectories = rootEntries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => compareEntryNames(left.name, right.name));

    if (rootFiles.length > 0 || rootDirectories.length === 0) {
      sections.push({
        id: `${presetType}:root`,
        title: PRESET_ROOT_SECTION_LABELS[presetType],
        entries: rootFiles,
      });
    }

    for (const directory of rootDirectories) {
      const entries = await this.collectPresetSectionEntries(
        presetType,
        rootDirectory,
        [directory.name],
      );
      if (entries.length === 0) {
        continue;
      }

      sections.push({
        id: `${presetType}:${directory.name}`,
        title: directory.name,
        entries,
      });
    }

    return sections;
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

  public async listPresetBrowserSections(): Promise<ListPresetBrowserSectionsResponse> {
    try {
      return {
        status: 'ok',
        sections: (
          await Promise.all(
            (['device', 'group', 'rack'] as const).map((presetType) =>
              this.listPresetBrowserSectionsByType(presetType)
            ),
          )
        ).flat(),
      };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to list preset browser sections.'),
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
}
