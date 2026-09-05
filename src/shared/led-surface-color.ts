import { clamp } from './math';

const LED_SURFACE_GAMMA = 0.5;
const LED_SURFACE_PAD_FLOOR = 45;
const LED_SURFACE_PAD_GAIN = 1.075;

export type RgbChannels = [number, number, number];

const parseRgbChannels = (rgb: string): RgbChannels | null => {
  const values = rgb
    .trim()
    .split(/\s+/)
    .map((value) => Number(value));
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return values.map((value) => Math.round(clamp(value, 0, 255))) as RgbChannels;
};

const liftLedSurfaceChannel = (channel: number): number => {
  const normalized = channel / 255;
  const gammaAdjusted = Math.pow(normalized, LED_SURFACE_GAMMA) * 255;
  return Math.round(Math.min(
    255,
    (LED_SURFACE_PAD_FLOOR * (1 - normalized))
      + (gammaAdjusted * LED_SURFACE_PAD_GAIN),
  ));
};

/**
 * Approximates the lit pad surface color instead of the bare LED color.
 * Keeps fully-off LEDs black so velocity 0 still reads as unlit.
 */
export const resolveLedSurfaceRgbChannels = (
  rgb: string,
): RgbChannels | null => {
  const channels = parseRgbChannels(rgb);
  if (!channels || channels.every((channel) => channel === 0)) {
    return channels;
  }

  return channels.map(liftLedSurfaceChannel) as RgbChannels;
};

export const resolveLedSurfaceRgb = (rgb: string): string => {
  const channels = resolveLedSurfaceRgbChannels(rgb);
  return channels?.join(' ') ?? rgb;
};
