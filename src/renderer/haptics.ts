import type { HapticFeedbackPattern } from '../shared/contracts/ipc/api';

const HAPTIC_FEEDBACK_MIN_INTERVAL_MS = 75;

let lastHapticFeedbackAt = Number.NEGATIVE_INFINITY;

export const performHapticFeedback = (
  pattern: HapticFeedbackPattern,
): void => {
  const now = performance.now();
  // Alignment marks a distinct destination; continuous adjustment must not suppress it.
  if (pattern === 'generic' && now - lastHapticFeedbackAt < HAPTIC_FEEDBACK_MIN_INTERVAL_MS) {
    return;
  }

  lastHapticFeedbackAt = now;
  window.compass?.performHapticFeedback(pattern);
};
