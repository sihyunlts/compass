import scratchPresetText from '../assets/presets/racks/Scratch.compassrack?raw';
import snakePresetText from '../assets/presets/racks/Snake.compassrack?raw';
import spinPresetText from '../assets/presets/racks/Spin.compassrack?raw';
import sunrisePresetText from '../assets/presets/racks/Sunrise.compassrack?raw';
import type {
  PresetBrowserTreeFolderNode,
  ReadPresetEntryResponse,
} from './contracts/ipc/presets';
import {
  parsePresetFileText,
  resolvePresetBrowserPreview,
  resolvePresetNameFromFileName,
  type PresetFileErrorCode,
  type PresetFile,
  type PresetFileKind,
  type RackPresetFile,
} from './presets';

const BUNDLED_RACK_PRESET_COLLECTION = {
  id: 'sihyunlights',
  label: 'sihyunlights',
  icon: 'wand_stars',
} as const;

interface BundledRackPresetDefinition {
  fileName: string;
  text: string;
}

type BundledRackPresetEntry =
  | {
      loadStatus: 'loaded';
      id: string;
      label: string;
      relativePath: string[];
      preset: RackPresetFile;
      needsSave: boolean;
    }
  | {
      loadStatus: 'error';
      id: string;
      label: string;
      relativePath: string[];
      errorCode: PresetFileErrorCode;
    };

const BUNDLED_RACK_PRESET_DEFINITIONS = [
  { fileName: 'Scratch.compassrack', text: scratchPresetText },
  { fileName: 'Snake.compassrack', text: snakePresetText },
  { fileName: 'Spin.compassrack', text: spinPresetText },
  { fileName: 'Sunrise.compassrack', text: sunrisePresetText },
] as const satisfies readonly BundledRackPresetDefinition[];

const buildBundledRackPresetEntry = (
  definition: BundledRackPresetDefinition,
): BundledRackPresetEntry => {
  const label = resolvePresetNameFromFileName(definition.fileName, 'rack')
    ?? definition.fileName;
  const relativePath = [
    BUNDLED_RACK_PRESET_COLLECTION.id,
    definition.fileName,
  ];
  const parsed = parsePresetFileText(definition.text, {
    fileName: definition.fileName,
  });
  if (parsed.ok === false) {
    return {
      loadStatus: 'error',
      id: definition.fileName,
      label,
      relativePath,
      errorCode: parsed.errorCode,
    };
  }
  if (parsed.preset.presetType !== 'rack') {
    return {
      loadStatus: 'error',
      id: definition.fileName,
      label,
      relativePath,
      errorCode: 'preset-type-mismatch',
    };
  }

  return {
    loadStatus: 'loaded',
    id: definition.fileName,
    label,
    relativePath,
    preset: parsed.preset,
    needsSave: parsed.needsSave,
  };
};

const BUNDLED_RACK_PRESET_ENTRIES = BUNDLED_RACK_PRESET_DEFINITIONS.map(
  (definition) => buildBundledRackPresetEntry(definition),
);

export const buildBundledRackPresetCollectionNode =
  (): PresetBrowserTreeFolderNode => ({
    kind: 'folder',
    id: `bundled:preset:rack:${BUNDLED_RACK_PRESET_COLLECTION.id}`,
    label: BUNDLED_RACK_PRESET_COLLECTION.label,
    presetType: 'rack',
    source: 'bundled',
    icon: BUNDLED_RACK_PRESET_COLLECTION.icon,
    relativePath: [BUNDLED_RACK_PRESET_COLLECTION.id],
    children: BUNDLED_RACK_PRESET_ENTRIES.map((entry) => {
      const base = {
        kind: 'preset' as const,
        id: `bundled:preset:rack:${entry.relativePath.join('/')}`,
        label: entry.label,
        presetType: 'rack' as const,
        source: 'bundled' as const,
        relativePath: [...entry.relativePath],
      };
      if (entry.loadStatus === 'error') {
        return {
          ...base,
          loadStatus: 'error' as const,
          loadErrorCode: entry.errorCode,
        };
      }

      return {
        ...base,
        loadStatus: 'loaded' as const,
        savedAtIso: entry.preset.savedAtIso,
        preview: resolvePresetBrowserPreview(entry.preset),
      };
    }),
  });

export const readBundledRackPreset = <K extends PresetFileKind>(
  presetType: K,
  relativePath: readonly string[],
): ReadPresetEntryResponse<K> => {
  if (presetType !== 'rack') {
    return {
      status: 'error',
      errorCode: 'preset-type-mismatch',
      message: 'Bundled preset type does not match the request.',
    };
  }

  const entry = BUNDLED_RACK_PRESET_ENTRIES.find(
    (entry) =>
      entry.relativePath.length === relativePath.length
      && entry.relativePath.every((segment, index) => segment === relativePath[index]),
  );
  if (!entry) {
    return {
      status: 'error',
      errorCode: 'preset-not-found',
      message: 'Bundled preset does not exist.',
    };
  }
  if (entry.loadStatus === 'error') {
    return {
      status: 'error',
      errorCode: entry.errorCode,
      message: 'Bundled preset is invalid.',
    };
  }

  return {
    status: 'loaded',
    filePath: null,
    payload: structuredClone(entry.preset) as Extract<PresetFile, { presetType: K }>,
    needsSave: entry.needsSave,
  };
};
