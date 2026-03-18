import type { GeneratorChain, GeneratorDeviceNode } from './model';

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
    }
  | {
      ok: false;
      message: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isDeviceLike = (value: unknown): value is GeneratorDeviceNode =>
  isRecord(value)
  && typeof value.id === 'string'
  && typeof value.kind === 'string'
  && typeof value.enabled === 'boolean';

const isGroupLike = (
  value: unknown,
): value is GroupPresetFile['group'] =>
  isRecord(value)
  && typeof value.enabled === 'boolean'
  && (value.name === null || typeof value.name === 'string')
  && Array.isArray(value.devices)
  && value.devices.every(isDeviceLike);

const isChainLike = (value: unknown): value is GeneratorChain =>
  isRecord(value)
  && Array.isArray(value.devices)
  && value.devices.every(isDeviceLike)
  && isRecord(value.groupStateById);

export const isPresetFileKind = (value: unknown): value is PresetFileKind =>
  value === 'device' || value === 'group' || value === 'rack';

export const isDevicePresetFile = (value: unknown): value is DevicePresetFile =>
  isRecord(value)
  && value.schemaVersion === PRESET_FILE_SCHEMA_VERSION
  && value.presetType === 'device'
  && typeof value.savedAtIso === 'string'
  && isDeviceLike(value.device);

export const isGroupPresetFile = (value: unknown): value is GroupPresetFile =>
  isRecord(value)
  && value.schemaVersion === PRESET_FILE_SCHEMA_VERSION
  && value.presetType === 'group'
  && typeof value.savedAtIso === 'string'
  && isGroupLike(value.group);

export const isRackPresetFile = (value: unknown): value is RackPresetFile =>
  isRecord(value)
  && value.schemaVersion === PRESET_FILE_SCHEMA_VERSION
  && value.presetType === 'rack'
  && typeof value.savedAtIso === 'string'
  && isChainLike(value.chain);

export const isPresetFile = (value: unknown): value is PresetFile =>
  isDevicePresetFile(value)
  || isGroupPresetFile(value)
  || isRackPresetFile(value);

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

  if (!isPresetFile(parsed)) {
    return {
      ok: false,
      message: 'Invalid preset file format.',
    };
  }

  if (extensionType && parsed.presetType !== extensionType) {
    return {
      ok: false,
      message: 'Preset file extension does not match the preset payload.',
    };
  }

  if (options.expectedType && parsed.presetType !== options.expectedType) {
    return {
      ok: false,
      message: `Expected a ${options.expectedType} preset file.`,
    };
  }

  return {
    ok: true,
    preset: parsed,
  };
};
