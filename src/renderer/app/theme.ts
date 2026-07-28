import {
  loadThemeSettings,
  saveThemeSettings,
  type ThemeSettings,
} from '../features/editor/persistence-storage';
import { RENDERER_STATE_KEY } from '../persisted-state';

const KAGUYA_HUE_CYCLE_MS = 2_000;

let currentThemeSettings: ThemeSettings | null = null;
let kaguyaThemeFrameId: number | null = null;
let kaguyaThemeStartTime = 0;
let kaguyaThemeStartHue = 0;

const applyThemeSettings = (settings: ThemeSettings): void => {
  document.documentElement.style.setProperty('--theme-hue', String(settings.hue));
  document.documentElement.style.setProperty(
    '--theme-chroma-scale',
    String(settings.saturation / 100),
  );
};

const renderKaguyaThemeFrame = (time: number): void => {
  const progress = (time - kaguyaThemeStartTime) / KAGUYA_HUE_CYCLE_MS;
  const hue = (kaguyaThemeStartHue + progress * 360) % 360;
  applyThemeSettings({ hue, saturation: 100 });
  kaguyaThemeFrameId = window.requestAnimationFrame(renderKaguyaThemeFrame);
};

/** Toggles the Kaguya rack theme without changing the saved theme settings. */
export const setKaguyaThemeEnabled = (enabled: boolean): void => {
  if (enabled === (kaguyaThemeFrameId !== null)) {
    return;
  }

  if (enabled) {
    const current = currentThemeSettings ?? loadThemeSettings();
    kaguyaThemeStartHue = current.hue;
    kaguyaThemeStartTime = window.performance.now();
    renderKaguyaThemeFrame(kaguyaThemeStartTime);
    return;
  }

  if (kaguyaThemeFrameId !== null) {
    window.cancelAnimationFrame(kaguyaThemeFrameId);
    kaguyaThemeFrameId = null;
  }
  applyThemeSettings(currentThemeSettings ?? loadThemeSettings());
};

/** Applies and persists a partial theme update. */
export const updateThemeSettings = (
  patch: Partial<ThemeSettings>,
): ThemeSettings => {
  const next = saveThemeSettings({
    ...(currentThemeSettings ?? loadThemeSettings()),
    ...patch,
  });
  currentThemeSettings = next;
  if (kaguyaThemeFrameId === null) {
    applyThemeSettings(next);
  }
  return next;
};

/** Restores the saved theme before the Svelte view mounts and syncs other renderer windows. */
export const initializeTheme = (): void => {
  currentThemeSettings = loadThemeSettings();
  applyThemeSettings(currentThemeSettings);
  window.addEventListener('storage', (event) => {
    if (event.key === RENDERER_STATE_KEY) {
      currentThemeSettings = loadThemeSettings();
      if (kaguyaThemeFrameId === null) {
        applyThemeSettings(currentThemeSettings);
      }
    }
  });
};
