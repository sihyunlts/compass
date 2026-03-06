import SymmetryDeviceUi from './ui.svelte';
import { symmetryDeviceControls } from './controls';
import { symmetryDeviceSchema } from './schema';

export const symmetryDeviceDefinition = {
  ...symmetryDeviceSchema,
  editor: SymmetryDeviceUi,
  controls: symmetryDeviceControls,
} as const;
