import {
  DEFAULT_AUTO_CREATE_LENGTH_BEATS,
  sanitizeAutoCreateLengthBeats,
} from '../beat-length';
import type { BridgeSettings } from '../bridge';

export const DEFAULT_BRIDGE_SETTINGS: BridgeSettings = {
  autoCreateLengthBeats: DEFAULT_AUTO_CREATE_LENGTH_BEATS,
};

export const sanitizeBridgeSettings = (
  raw: Partial<BridgeSettings> | null | undefined,
): BridgeSettings => {
  const autoCreateLengthBeats = sanitizeAutoCreateLengthBeats(
    raw?.autoCreateLengthBeats,
    DEFAULT_BRIDGE_SETTINGS.autoCreateLengthBeats,
  );

  return {
    autoCreateLengthBeats,
  };
};
