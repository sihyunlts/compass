import MirrorDeviceUi from './ui.svelte';
import { mirrorDeviceControls } from './controls';
import { mirrorDeviceSchema } from './schema';

export const mirrorDeviceDefinition = {
  ...mirrorDeviceSchema,
  editor: MirrorDeviceUi,
  controls: mirrorDeviceControls,
} as const;
