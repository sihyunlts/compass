import {
  cloneDeviceNode,
  type GeneratorChain,
  type GeneratorDeviceNode,
} from './model';
import {
  formatInvalidHydratedDeviceWarning,
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
}

export interface RackPresetFile extends PresetFileBase<'rack'> {
  chain: GeneratorChain;
}

export type PresetFile = DevicePresetFile | GroupPresetFile | RackPresetFile;

export type ParsedPresetFileResult =
  | {
      ok: true;
      preset: PresetFile;
      warning?: string;
    }
  | {
      ok: false;
      message: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isPresetFileKind = (value: unknown): value is PresetFileKind =>
  value === 'device' || value === 'group' || value === 'rack';

const isPresetFileHeader = (
  value: unknown,
): value is {
  schemaVersion: typeof PRESET_FILE_SCHEMA_VERSION;
  presetType: PresetFileKind;
  savedAtIso: string;
} =>
  isRecord(value)
  && value.schemaVersion === PRESET_FILE_SCHEMA_VERSION
  && isPresetFileKind(value.presetType)
  && typeof value.savedAtIso === 'string';

interface ParsedPresetPayload {
  preset: PresetFile;
  warning?: string;
}

export const toStandaloneDevicePresetDevice = (
  device: GeneratorDeviceNode,
): GeneratorDeviceNode => {
  const next = cloneDeviceNode(device);
  next.groupId = null;
  return next;
};

const parseDevicePresetFile = (
  value: unknown,
): ParsedPresetPayload | null => {
  if (!isPresetFileHeader(value) || value.presetType !== 'device') {
    return null;
  }

  const device = hydrateImportedGeneratorDevice((value as { device?: unknown }).device);
  if (!device) {
    return null;
  }

  return {
    preset: {
      schemaVersion: value.schemaVersion,
      presetType: value.presetType,
      savedAtIso: value.savedAtIso,
      device: toStandaloneDevicePresetDevice(device),
    },
  };
};

const parseGroupPresetFile = (
  value: unknown,
  options: {
    rejectInvalidDevices?: boolean;
  } = {},
): ParsedPresetPayload | null => {
  if (!isPresetFileHeader(value) || value.presetType !== 'group') {
    return null;
  }

  const group = (value as { group?: unknown }).group;
  if (
    !isRecord(group)
    || typeof group.enabled !== 'boolean'
    || (group.name !== null && typeof group.name !== 'string')
    || !Array.isArray(group.devices)
  ) {
    return null;
  }

  const hydratedDevices = hydrateImportedGeneratorDevices(group.devices, options);
  if (!hydratedDevices) {
    return null;
  }
  if (group.devices.length > 0 && hydratedDevices.devices.length === 0) {
    return null;
  }

  const groupEnabled = group.enabled as boolean;
  const groupName = group.name as string | null;

  return {
    preset: {
      schemaVersion: value.schemaVersion,
      presetType: value.presetType,
      savedAtIso: value.savedAtIso,
      group: {
        enabled: groupEnabled,
        name: groupName,
        devices: hydratedDevices.devices,
      },
    },
    warning: formatInvalidHydratedDeviceWarning(
      hydratedDevices.invalidDeviceCount,
      'importing preset',
    ),
  };
};

const parseRackPresetFile = (
  value: unknown,
  options: {
    rejectInvalidDevices?: boolean;
  } = {},
): ParsedPresetPayload | null => {
  if (!isPresetFileHeader(value) || value.presetType !== 'rack') {
    return null;
  }

  const hydratedChain = hydrateImportedGeneratorChain(
    (value as { chain?: unknown }).chain,
    options,
  );
  const sourceDevices = (value as {
    chain?: { devices?: unknown };
  }).chain?.devices;
  if (
    !hydratedChain
    || (Array.isArray(sourceDevices) && sourceDevices.length > 0 && hydratedChain.chain.devices.length === 0)
  ) {
    return null;
  }

  return {
    preset: {
      schemaVersion: value.schemaVersion,
      presetType: value.presetType,
      savedAtIso: value.savedAtIso,
      chain: hydratedChain.chain,
    },
    warning: formatInvalidHydratedDeviceWarning(
      hydratedChain.invalidDeviceCount,
      'importing preset',
    ),
  };
};

export const parsePresetFile = (
  value: unknown,
  options: {
    rejectInvalidDevices?: boolean;
  } = {},
): ParsedPresetPayload | null =>
  parseDevicePresetFile(value)
  ?? parseGroupPresetFile(value, options)
  ?? parseRackPresetFile(value, options);

export const resolvePresetFileKindFromName = (
  fileName: string,
): PresetFileKind | null => {
  const normalized = fileName.trim().toLowerCase();
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

export const parsePresetFileText = (
  text: string,
  options: {
    fileName?: string;
    expectedType?: PresetFileKind;
  } = {},
): ParsedPresetFileResult => {
  const extensionType = options.fileName
    ? resolvePresetFileKindFromName(options.fileName)
    : null;
  if (options.fileName && !extensionType) {
    return {
      ok: false,
      message: 'Unsupported preset file extension.',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      message: 'Invalid preset file format.',
    };
  }

  const parsedPreset = parsePresetFile(parsed);
  if (!parsedPreset) {
    return {
      ok: false,
      message: 'Invalid preset file format.',
    };
  }

  const { preset, warning } = parsedPreset;
  if (extensionType && preset.presetType !== extensionType) {
    return {
      ok: false,
      message: 'Preset file extension does not match the preset payload.',
    };
  }

  if (options.expectedType && preset.presetType !== options.expectedType) {
    return {
      ok: false,
      message: `Expected a ${options.expectedType} preset file.`,
    };
  }

  return {
    ok: true,
    preset,
    warning,
  };
};
