export const THEME_PRESETS = [
  { id: 'default', hue: 265, saturation: 50 },
  { id: 'dune', hue: 45, saturation: 20 },
  { id: 'lagoon', hue: 180, saturation: 50 },
  { id: 'crimson', hue: 0, saturation: 60 },
  { id: 'ultraviolet', hue: 300, saturation: 80 },
] as const;

export type ThemePresetId = (typeof THEME_PRESETS)[number]['id'];
export type ThemeSelectionId = ThemePresetId | 'custom';

export const DEFAULT_THEME_PRESET = THEME_PRESETS[0];

export const findThemePreset = (id: ThemePresetId) =>
  THEME_PRESETS.find((preset) => preset.id === id) ?? DEFAULT_THEME_PRESET;

export const resolveThemeSelection = (
  hue: number,
  saturation: number,
): ThemeSelectionId =>
  THEME_PRESETS.find(
    (preset) => preset.hue === hue && preset.saturation === saturation,
  )?.id ?? 'custom';

export const isThemePresetId = (value: unknown): value is ThemePresetId =>
  THEME_PRESETS.some((preset) => preset.id === value);
