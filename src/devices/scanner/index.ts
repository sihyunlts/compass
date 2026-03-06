import ScannerDeviceUi from './ui.svelte';
import { scannerDeviceControls } from './controls';
import { scannerDeviceSchema } from './schema';

export const scannerDeviceDefinition = {
  ...scannerDeviceSchema,
  editor: ScannerDeviceUi,
  controls: scannerDeviceControls,
} as const;
