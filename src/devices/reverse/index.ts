import ReverseDeviceUi from './ui.svelte';
import { reverseDeviceSchema } from './schema';

export const reverseDeviceDefinition = {
  ...reverseDeviceSchema,
  editor: ReverseDeviceUi,
} as const;
