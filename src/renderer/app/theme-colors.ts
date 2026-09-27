// Dynamic OKLCH colors have one definition for both native CSS and sRGB fallback.
const THEME_COLORS = [
  ['--theme-tone-00', 0.16, 0.003, true],
  ['--theme-tone-10', 0.23, 0.010, true],
  ['--theme-tone-20', 0.30, 0.017, true],
  ['--theme-tone-30', 0.36, 0.022, true],
  ['--theme-tone-40', 0.43, 0.026, true],
  ['--theme-tone-50', 0.55, 0.023, true],
  ['--theme-tone-60', 0.72, 0.026, true],
  ['--theme-tone-90', 0.93, 0.009, true],
  ['--theme-floating-highlight', 1, 0.05, true],
  ['--theme-saturation-muted', 0.65, 0, false],
  ['--theme-saturation-color', 0.65, 0.14, false],
] as const;

// OKLab author's public-domain conversion, followed by sRGB encoding/clipping.
// https://bottosson.github.io/posts/oklab/#converting-from-linear-srgb-to-oklab
const oklchToRgb = (lightness: number, chroma: number, hue: number): number[] => {
  if (lightness >= 1) return [255, 255, 255];
  const radians = hue * Math.PI / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map((linear) => {
    const encoded = linear <= 0.0031308
      ? 12.92 * linear
      : 1.055 * linear ** (1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, encoded)) * 255);
  });
};

let supportsOklch: boolean | undefined;
let needsRgbChannels: boolean;

export const applyThemeColors = (hue: number, chromaScale: number): void => {
  const style = document.documentElement.style;
  if (supportsOklch === undefined) {
    supportsOklch = CSS.supports('color', 'oklch(50% 0.1 180)');
    needsRgbChannels = !supportsOklch
      || !CSS.supports('color', 'color-mix(in oklch, black, transparent)');
    if (supportsOklch) {
      for (const [name, lightness, chroma, scalesWithTheme] of THEME_COLORS) {
        const cssChroma = scalesWithTheme ? `calc(${chroma} * var(--theme-chroma-scale))` : chroma;
        style.setProperty(name, `oklch(${lightness} ${cssChroma} var(--theme-hue))`);
      }
    }
  }

  // Modern engines keep doing the color work in CSS, including animated themes.
  style.setProperty('--theme-hue', String(hue));
  style.setProperty('--theme-chroma-scale', String(chromaScale));
  if (!needsRgbChannels) return;

  for (const [name, lightness, chroma, scalesWithTheme] of THEME_COLORS) {
    const channels = oklchToRgb(lightness, chroma * (scalesWithTheme ? chromaScale : 1), hue).join(', ');
    style.setProperty(`${name}-rgb`, channels);
    if (!supportsOklch) style.setProperty(name, `rgb(${channels})`);
  }
};
