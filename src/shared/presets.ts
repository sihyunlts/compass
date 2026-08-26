import {
  cloneDeviceNode,
  normalizeAuthoredMetadata,
  replaceAuthoredMetadata,
  type AuthoredMetadata,
  type GeneratorChain,
  type GeneratorDeviceNode,
  type GeneratorNode,
  type TimeWarpCurve,
  isGeneratorNode,
} from './model';
import {
  hydrateImportedGeneratorChain,
  hydrateImportedGeneratorDevice,
  hydrateImportedGeneratorDevices,
} from './model/chain-normalization';
import { migratePresetValue } from './preset-migrations';

export const PRESET_FILE_SCHEMA_VERSION = 2 as const;

export type PresetFileKind = 'device' | 'group' | 'rack';

export type PresetEntrySource = 'user' | 'bundled';

export const isPresetEntrySource = (value: unknown): value is PresetEntrySource =>
  value === 'user' || value === 'bundled';

export type PresetFileErrorCode =
  | 'extension-payload-mismatch'
  | 'file-read-failed'
  | 'invalid-file-format'
  | 'invalid-file-path'
  | 'invalid-read-request'
  | 'preset-not-found'
  | 'preset-type-mismatch'
  | 'unsupported-file-extension';

export const PRESET_FILE_EXTENSIONS = {
  device: '.compassdevice',
  group: '.compassgroup',
  rack: '.compassrack',
} as const satisfies Record<PresetFileKind, string>;

interface PresetFileBase<K extends PresetFileKind> {
  schemaVersion: typeof PRESET_FILE_SCHEMA_VERSION;
  presetType: K;
  savedAtIso: string;
}

export interface DevicePresetFile extends PresetFileBase<'device'> {
  device: GeneratorDeviceNode;
}

export interface GroupPresetFile extends PresetFileBase<'group'> {
  group: {
    enabled: boolean;
    name: string | null;
    metadata?: AuthoredMetadata;
    devices: GeneratorDeviceNode[];
  };
  ui?: PresetFileUiMetadata;
}

interface PresetFileUiMetadata {
  collapsedDeviceIds?: string[];
}

export interface RackPresetFile extends PresetFileBase<'rack'> {
  chain: GeneratorChain;
  ui?: PresetFileUiMetadata;
}

export type PresetFile = DevicePresetFile | GroupPresetFile | RackPresetFile;

interface PresetBrowserPreviewBase {
  author?: string;
}

interface ColorPresetBrowserPreview extends PresetBrowserPreviewBase {
  kind: 'color';
  velocities: number[];
}

interface TimeWarpPresetBrowserPreview extends PresetBrowserPreviewBase {
  kind: 'timewarp';
  curve: TimeWarpCurve;
}

interface GeneratorPresetBrowserPreview extends PresetBrowserPreviewBase {
  kind: 'generator';
  device: GeneratorNode;
}

interface RackPresetBrowserPreview extends PresetBrowserPreviewBase {
  kind: 'rack';
}

export type PresetBrowserPreview =
  | ColorPresetBrowserPreview
  | TimeWarpPresetBrowserPreview
  | GeneratorPresetBrowserPreview
  | RackPresetBrowserPreview;

export const resolvePresetBrowserPreview = (
  preset: PresetFile,
): PresetBrowserPreview | undefined => {
  if (preset.presetType === 'rack') {
    const author = preset.chain.metadata?.author;
    return {
      kind: 'rack',
      ...(author ? { author } : {}),
    };
  }
  if (preset.presetType !== 'device') {
    return undefined;
  }

  const author = preset.device.metadata?.author;
  if (preset.device.kind === 'color') {
    return {
      kind: 'color',
      velocities: [...preset.device.params.velocities],
      ...(author ? { author } : {}),
    };
  }
  if (preset.device.kind === 'timewarp') {
    return {
      kind: 'timewarp',
      curve: {
        divisions: preset.device.params.curve.divisions,
        nodes: preset.device.params.curve.nodes.map((node) => ({ ...node })),
      },
      ...(author ? { author } : {}),
    };
  }
  if (isGeneratorNode(preset.device)) {
    return {
      kind: 'generator',
      device: preset.device,
      ...(author ? { author } : {}),
    };
  }

  return undefined;
};

export const withPresetAuthoredMetadata = (
  preset: PresetFile,
  metadata: AuthoredMetadata | undefined,
  savedAtIso: string,
): PresetFile => {
  if (preset.presetType === 'device') {
    return {
      ...preset,
      savedAtIso,
      device: replaceAuthoredMetadata(preset.device, metadata),
    };
  }

  if (preset.presetType === 'group') {
    return {
      ...preset,
      savedAtIso,
      group: replaceAuthoredMetadata(preset.group, metadata),
    };
  }

  return {
    ...preset,
    savedAtIso,
    chain: replaceAuthoredMetadata(preset.chain, metadata),
  };
};

type ParsedPresetFileResult =
  | {
      ok: true;
      preset: PresetFile;
      needsSave: boolean;
    }
  | {
      ok: false;
      errorCode: PresetFileErrorCode;
      message: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toCollapsedDeviceIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      unique.add(item.trim());
    }
  }

  return [...unique];
};

export const sanitizeCollapsedDeviceIdsForDevices = (
  devices: readonly Pick<GeneratorDeviceNode, 'id'>[],
  value: unknown,
): string[] => {
  const validIds = new Set(devices.map((device) => device.id));
  return toCollapsedDeviceIds(value).filter((id) => validIds.has(id));
};

export const sanitizeCollapsedDeviceIdsForChain = (
  chain: Pick<GeneratorChain, 'devices'>,
  value: unknown,
): string[] => sanitizeCollapsedDeviceIdsForDevices(chain.devices, value);

const extractBaseName = (fileName: string): string => {
  const separatorIndex = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'));
  return separatorIndex === -1 ? fileName : fileName.slice(separatorIndex + 1);
};

export const isPresetFileKind = (value: unknown): value is PresetFileKind =>
  value === 'device' || value === 'group' || value === 'rack';

const parsePresetFileHeader = (
  value: unknown,
): {
  schemaVersion: typeof PRESET_FILE_SCHEMA_VERSION;
  presetType: PresetFileKind;
  savedAtIso: string;
} | null =>
  isRecord(value)
  && value.schemaVersion === PRESET_FILE_SCHEMA_VERSION
  && isPresetFileKind(value.presetType)
  && typeof value.savedAtIso === 'string'
    ? {
        schemaVersion: value.schemaVersion,
        presetType: value.presetType,
        savedAtIso: value.savedAtIso,
      }
    : null;

interface ParsedPresetPayload {
  preset: PresetFile;
  needsSave: boolean;
}

const hasStoredName = (value: unknown): boolean =>
  isRecord(value) && Object.hasOwn(value, 'name');

export const toStandaloneDevicePresetDevice = (
  device: GeneratorDeviceNode,
): GeneratorDeviceNode => {
  const next = cloneDeviceNode(device);
  next.groupId = null;
  return next;
};

const parseDevicePresetPayload = (
  rawDevice: unknown,
  header: {
    schemaVersion: typeof PRESET_FILE_SCHEMA_VERSION;
    savedAtIso: string;
  },
): ParsedPresetPayload | null => {
  const device = hydrateImportedGeneratorDevice(rawDevice);
  if (!device) {
    return null;
  }

  return {
    preset: {
      schemaVersion: header.schemaVersion,
      presetType: 'device',
      savedAtIso: header.savedAtIso,
      device: toStandaloneDevicePresetDevice(device),
    },
    needsSave: false,
  };
};

const parseGroupPresetPayload = (
  rawGroup: unknown,
  rawUi: unknown,
  header: {
    schemaVersion: typeof PRESET_FILE_SCHEMA_VERSION;
    savedAtIso: string;
  },
): ParsedPresetPayload | null => {
  const group = rawGroup;
  if (
    !isRecord(group)
    || typeof group.enabled !== 'boolean'
    || group.name !== undefined && group.name !== null && typeof group.name !== 'string'
    || !Array.isArray(group.devices)
    || group.devices.length === 0
  ) {
    return null;
  }

  const hydratedDevices = hydrateImportedGeneratorDevices(group.devices);
  if (!hydratedDevices) {
    return null;
  }

  const collapsedDeviceIds = sanitizeCollapsedDeviceIdsForDevices(
    hydratedDevices,
    isRecord(rawUi) ? rawUi.collapsedDeviceIds : undefined,
  );
  const metadata = normalizeAuthoredMetadata(group.metadata);

  return {
    preset: {
      schemaVersion: header.schemaVersion,
      presetType: 'group',
      savedAtIso: header.savedAtIso,
      group: {
        enabled: group.enabled,
        name: typeof group.name === 'string' ? group.name : null,
        ...(metadata ? { metadata } : {}),
        devices: hydratedDevices,
      },
      ...(collapsedDeviceIds.length > 0
        ? {
            ui: {
              collapsedDeviceIds,
            },
          }
        : {}),
    },
    needsSave: false,
  };
};

const parseRackPresetPayload = (
  rawChain: unknown,
  rawUi: unknown,
  header: {
    schemaVersion: typeof PRESET_FILE_SCHEMA_VERSION;
    savedAtIso: string;
  },
): ParsedPresetPayload | null => {
  const hydratedChain = hydrateImportedGeneratorChain(rawChain);
  if (!hydratedChain) {
    return null;
  }

  const collapsedDeviceIds = sanitizeCollapsedDeviceIdsForChain(
    hydratedChain,
    isRecord(rawUi) ? rawUi.collapsedDeviceIds : undefined,
  );

  return {
    preset: {
      schemaVersion: header.schemaVersion,
      presetType: 'rack',
      savedAtIso: header.savedAtIso,
      chain: hydratedChain,
      ...(collapsedDeviceIds.length > 0
        ? {
            ui: {
              collapsedDeviceIds,
            },
          }
        : {}),
    },
    needsSave: false,
  };
};

export const parsePresetFile = (
  value: unknown,
): ParsedPresetPayload | null => {
  const header = parsePresetFileHeader(value);
  if (!header) {
    return null;
  }

  if (header.presetType === 'device') {
    return parseDevicePresetPayload((value as { device?: unknown }).device, header);
  }

  if (header.presetType === 'group') {
    return parseGroupPresetPayload(
      (value as { group?: unknown }).group,
      (value as { ui?: unknown }).ui,
      header,
    );
  }

  return parseRackPresetPayload(
    (value as { chain?: unknown }).chain,
    (value as { ui?: unknown }).ui,
    header,
  );
};

export const parseStoredPresetValue = (
  value: unknown,
): ParsedPresetPayload | null => {
  const migrated = migratePresetValue(value, PRESET_FILE_SCHEMA_VERSION);
  if (!migrated) {
    return null;
  }

  const parsed = parsePresetFile(migrated.value);

  return parsed
    ? {
        ...parsed,
        needsSave: migrated.migrated,
      }
    : null;
};

const resolvePresetFileKindFromName = (
  fileName: string,
): PresetFileKind | null => {
  const normalized = extractBaseName(fileName).trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  for (const [presetType, extension] of Object.entries(PRESET_FILE_EXTENSIONS)) {
    if (normalized.endsWith(extension)) {
      return presetType as PresetFileKind;
    }
  }

  return null;
};

export const resolvePresetNameFromFileName = (
  fileName: string,
  presetType: PresetFileKind,
): string | null => {
  const baseName = extractBaseName(fileName).trim();
  const extension = PRESET_FILE_EXTENSIONS[presetType];
  if (!baseName.toLowerCase().endsWith(extension)) {
    return null;
  }

  const stem = baseName.slice(0, -extension.length).trim();
  return stem || null;
};

const applyPresetNameFromFileName = (
  preset: PresetFile,
  fileName: string,
): PresetFile => {
  const presetName = resolvePresetNameFromFileName(fileName, preset.presetType);
  if (!presetName) {
    return preset;
  }

  if (preset.presetType === 'device') {
    return {
      ...preset,
      device: {
        ...preset.device,
        name: presetName,
      },
    };
  }

  if (preset.presetType === 'rack') {
    return {
      ...preset,
      chain: {
        ...preset.chain,
        name: presetName,
      },
    };
  }

  return {
    ...preset,
    group: {
      ...preset.group,
      name: presetName,
    },
  };
};

const hasSerializedPresetName = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }
  if (value.presetType === 'device') {
    return hasStoredName(value.device);
  }
  if (value.presetType === 'group') {
    return hasStoredName(value.group);
  }
  return false;
};

interface ParsePresetFileTextOptions {
  fileName: string;
}

export const parsePresetFileText = (
  text: string,
  options: ParsePresetFileTextOptions,
): ParsedPresetFileResult => {
  const extensionType = resolvePresetFileKindFromName(options.fileName);
  if (!extensionType) {
    return {
      ok: false,
      errorCode: 'unsupported-file-extension',
      message: 'Unsupported file extension.',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      errorCode: 'invalid-file-format',
      message: 'Invalid file format.',
    };
  }

  if (hasSerializedPresetName(parsed)) {
    return {
      ok: false,
      errorCode: 'invalid-file-format',
      message: 'Invalid file format.',
    };
  }

  const parsedPreset = parseStoredPresetValue(parsed);
  if (!parsedPreset) {
    return {
      ok: false,
      errorCode: 'invalid-file-format',
      message: 'Invalid file format.',
    };
  }

  const { preset } = parsedPreset;
  if (preset.presetType !== extensionType) {
    return {
      ok: false,
      errorCode: 'extension-payload-mismatch',
      message: 'File extension does not match the file payload.',
    };
  }

  return {
    ok: true,
    preset: applyPresetNameFromFileName(preset, options.fileName),
    needsSave: parsedPreset.needsSave,
  };
};
