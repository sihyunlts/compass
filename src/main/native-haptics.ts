import type { HapticFeedbackPattern } from '../shared/contracts/ipc/api';
import { loadMacosNativeAddon } from './native-addon-loader';

interface NativeHapticsAddon {
  performAlignment: () => void;
  performGeneric: () => void;
}

let nativeAddon: NativeHapticsAddon | null | undefined;

const loadNativeAddon = (): NativeHapticsAddon | null => {
  if (nativeAddon === undefined) {
    nativeAddon = loadMacosNativeAddon<NativeHapticsAddon>(
      'compass_haptics.node',
      'Native haptics module',
    );
  }
  return nativeAddon;
};

export const performHapticFeedback = (
  pattern: HapticFeedbackPattern,
): void => {
  const addon = loadNativeAddon();
  if (pattern === 'generic') {
    addon?.performGeneric();
  } else {
    addon?.performAlignment();
  }
};
