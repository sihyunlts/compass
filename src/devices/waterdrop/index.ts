import WaterdropDeviceUi from './ui.svelte';
import { waterdropDeviceControls } from './controls';
import { waterdropDeviceSchema } from './schema';

export const waterdropDeviceDefinition = {
  ...waterdropDeviceSchema,
  editor: WaterdropDeviceUi,
  controls: waterdropDeviceControls,
} as const;
