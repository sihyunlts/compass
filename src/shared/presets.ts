import {
  cloneDeviceNode,
  type GeneratorChain,
  type GeneratorDeviceNode,
} from './model';
import {
  hydrateImportedGeneratorChain,
  hydrateImportedGeneratorDevice,
  hydrateImportedGeneratorDevices,
} from './model/chain-normalization';

export const PRESET_FILE_SCHEMA_VERSION = 1 as const;

export type PresetFileKind = 'device' | 'group' | 'rack';

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
    devices: GeneratorDeviceNode[];
  };
  ui?: PresetFileUiMetadata;
}

export interface PresetFileUiMetadata {
  collapsedDeviceIds?: string[];
}

export interface RackPresetFile extends PresetFileBase<'rack'> {
  chain: GeneratorChain;
  ui?: PresetFileUiMetadata;
}

export type PresetFile = DevicePresetFile | GroupPresetFile | RackPresetFile;

export type ParsedPresetFileResult =
  | {
      ok: true;
      preset: PresetFile;
    }
  | {
      ok: false;
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
  if (!hydratedDevices || hydratedDevices.length === 0) {
    return null;
  }

  const collapsedDeviceIds = sanitizeCollapsedDeviceIdsForDevices(
    hydratedDevices,
    isRecord(rawUi) ? rawUi.collapsedDeviceIds : undefined,
  );

  return {
    preset: {
      schemaVersion: header.schemaVersion,
      presetType: 'group',
      savedAtIso: header.savedAtIso,
      group: {
        enabled: group.enabled,
        name: typeof group.name === 'string' ? group.name : null,
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
  const sourceDevices = (rawChain as { devices?: unknown } | undefined)?.devices;
  if (
    !hydratedChain
    || (Array.isArray(sourceDevices) && sourceDevices.length > 0 && hydratedChain.devices.length === 0)
  ) {
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

const parseStoredDevicePresetPayload = (
  rawDevice: unknown,
  header: {
    schemaVersion: typeof PRESET_FILE_SCHEMA_VERSION;
    savedAtIso: string;
  },
): ParsedPresetPayload | null => {
  if (hasStoredName(rawDevice)) {
    return null;
  }

  return parseDevicePresetPayload(rawDevice, header);
};

const parseStoredGroupPresetPayload = (
  rawGroup: unknown,
  rawUi: unknown,
  header: {
    schemaVersion: typeof PRESET_FILE_SCHEMA_VERSION;
    savedAtIso: string;
  },
): ParsedPresetPayload | null => {
  if (hasStoredName(rawGroup)) {
    return null;
  }

  return parseGroupPresetPayload(rawGroup, rawUi, header);
};

const parseStoredPresetFile = (
  value: unknown,
): ParsedPresetPayload | null => {
  const header = parsePresetFileHeader(value);
  if (!header) {
    return null;
  }

  if (header.presetType === 'device') {
    return parseStoredDevicePresetPayload((value as { device?: unknown }).device, header);
  }

  if (header.presetType === 'group') {
    return parseStoredGroupPresetPayload(
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

export const resolvePresetFileKindFromName = (
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

const resolvePresetNameFromFileName = (
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
      message: 'Unsupported file extension.',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      message: 'Invalid file format.',
    };
  }

  const parsedPreset = parseStoredPresetFile(parsed);
  if (!parsedPreset) {
    return {
      ok: false,
      message: 'Invalid file format.',
    };
  }

  const { preset } = parsedPreset;
  if (preset.presetType !== extensionType) {
    return {
      ok: false,
      message: 'File extension does not match the file payload.',
    };
  }

  return {
    ok: true,
    preset: applyPresetNameFromFileName(preset, options.fileName),
  };
};
