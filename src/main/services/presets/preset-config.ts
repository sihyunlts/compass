import type { PresetFileKind } from '../../../shared/presets';

export const PRESET_ROOT_DIR_NAME = 'Presets';

export const PRESET_FILE_SPECS = {
  device: {
    directory: 'Devices',
    extension: '.compassdevice',
    filterName: 'Compass Devices',
    defaultName: 'Device',
  },
  group: {
    directory: 'Groups',
    extension: '.compassgroup',
    filterName: 'Compass Groups',
    defaultName: 'Group',
  },
  rack: {
    directory: 'Racks',
    extension: '.compassrack',
    filterName: 'Compass Racks',
    defaultName: 'Rack',
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
