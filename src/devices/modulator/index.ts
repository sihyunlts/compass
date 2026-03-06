import ModulatorDeviceUi from './ui.svelte';
import { modulatorDeviceControls } from './controls';
import { modulatorDeviceSchema } from './schema';

export const modulatorDeviceDefinition = {
  ...modulatorDeviceSchema,
  editor: ModulatorDeviceUi,
  controls: modulatorDeviceControls,
} as const;
