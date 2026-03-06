import SpiralDeviceUi from './ui.svelte';
import { spiralDeviceControls } from './controls';
import { spiralDeviceSchema } from './schema';

export const spiralDeviceDefinition = {
  ...spiralDeviceSchema,
  editor: SpiralDeviceUi,
  controls: spiralDeviceControls,
} as const;
