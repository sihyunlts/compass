import {
  loadThemeSettings,
  saveThemeSettings,
  type ThemeSettings,
} from '../features/editor/persistence-storage';
import { RENDERER_STATE_KEY } from '../persisted-state';

const applyThemeSettings = (settings: ThemeSettings): void => {
  document.documentElement.style.setProperty('--theme-hue', String(settings.hue));
  document.documentElement.style.setProperty(
    '--theme-chroma-scale',
    String(settings.saturation / 100),
  );
};

/** Applies and persists a partial theme update, returning the sanitized result. */
export const updateThemeSettings = (
  patch: Partial<ThemeSettings>,
): ThemeSettings => {
  const next = saveThemeSettings({
    ...loadThemeSettings(),
    ...patch,
  });
  applyThemeSettings(next);
  return next;
};

/** Restores the saved theme before the Svelte view mounts and syncs other renderer windows. */
export const initializeTheme = (): void => {
  applyThemeSettings(loadThemeSettings());
  window.addEventListener('storage', (event) => {
    if (event.key === RENDERER_STATE_KEY) {
      applyThemeSettings(loadThemeSettings());
    }
  });
};
