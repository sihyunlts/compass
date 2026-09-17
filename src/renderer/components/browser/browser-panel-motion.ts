import {
  createCubicBezierEasing,
  createSpringTransition,
  SPRING_PRECISION,
} from '../../motion';

export const BROWSER_SETTINGS_SPRING_OPTIONS = {
  stiffness: 0.28,
  damping: 1,
  precision: SPRING_PRECISION,
} as const;

export const BROWSER_SETTINGS_SPRING_TRANSITION = createSpringTransition(
  BROWSER_SETTINGS_SPRING_OPTIONS,
);

export const BROWSER_SETTINGS_FADE_DURATION_MS = 100;
export const browserSettingsFadeEasing = createCubicBezierEasing(
  0.25,
  0.1,
  0.25,
  1,
);
