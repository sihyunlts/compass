import type { PresetFileKind } from '../../../shared/presets';

export const PRESET_ROOT_DIR_NAME = 'Presets';

export const PRESET_FILE_SPECS = {
  device: {
    directory: 'Devices',
    extension: '.compassdevice',
    filterName: 'Compass Device Presets',
    defaultName: 'Device Preset',
  },
  group: {
    directory: 'Groups',
    extension: '.compassgroup',
    filterName: 'Compass Group Presets',
    defaultName: 'Group Preset',
  },
  rack: {
    directory: 'Racks',
    extension: '.compassrack',
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

export const PRESET_ROOT_SECTION_LABELS: Record<PresetFileKind, string> = {
  device: 'Devices',
  group: 'Groups',
  rack: 'Racks',
};
