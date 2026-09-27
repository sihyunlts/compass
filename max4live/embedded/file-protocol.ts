import type { CompassApi } from '../../src/shared/contracts/ipc/api';

export type FileServiceApi = Pick<
  CompassApi,
  | 'saveMidiFile'
  | 'savePresetFile'
  | 'saveRackFile'
  | 'updateRackFileInfo'
  | 'renamePresetFile'
  | 'updatePresetFileInfo'
  | 'createPresetFolder'
  | 'renamePresetFolder'
  | 'listPresetBrowserTree'
  | 'deletePresetEntries'
  | 'movePresetEntries'
  | 'copyPresetEntries'
  | 'readPresetEntry'
  | 'showPresetEntryInFolder'
>;

export type FileMethod = keyof FileServiceApi;
