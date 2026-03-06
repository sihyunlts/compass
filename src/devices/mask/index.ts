import MaskDeviceUi from './ui.svelte';
import { maskDeviceControls } from './controls';
import { maskDeviceSchema } from './schema';

export const maskDeviceDefinition = {
  ...maskDeviceSchema,
  editor: MaskDeviceUi,
  controls: maskDeviceControls,
} as const;
