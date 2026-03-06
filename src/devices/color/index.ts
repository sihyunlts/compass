import ColorDeviceUi from './ui.svelte';
import { colorDeviceControls } from './controls';
import { colorDeviceSchema } from './schema';

export const colorDeviceDefinition = {
  ...colorDeviceSchema,
  editor: ColorDeviceUi,
  controls: colorDeviceControls,
} as const;
