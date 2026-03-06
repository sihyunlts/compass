import RotateDeviceUi from './ui.svelte';
import { rotateDeviceControls } from './controls';
import { rotateDeviceSchema } from './schema';

export const rotateDeviceDefinition = {
  ...rotateDeviceSchema,
  editor: RotateDeviceUi,
  controls: rotateDeviceControls,
} as const;
