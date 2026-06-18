import { clamp } from '../../shared/math';

const LED_SURFACE_GAMMA = 0.5;
const LED_SURFACE_PAD_FLOOR = 45;
const LED_SURFACE_PAD_GAIN = 1.075;

const parseRgbChannels = (rgb: string): [number, number, number] | null => {
  const values = rgb
    .trim()
    .split(/\s+/)
    .map((value) => Number(value));
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return [
    Math.round(clamp(values[0], 0, 255)),
    Math.round(clamp(values[1], 0, 255)),
    Math.round(clamp(values[2], 0, 255)),
  ];
};

const applyLedSurfaceGamma = (channel: number): number =>
  Math.pow(clamp(channel, 0, 255) / 255, LED_SURFACE_GAMMA) * 255;

/**
 * Approximates the lit pad surface color instead of the bare LED color.
 * Keeps fully-off LEDs black so velocity 0 still reads as unlit.
 */
export const resolveLedSurfaceRgb = (rgb: string): string => {
  const channels = parseRgbChannels(rgb);
  if (!channels) {
    return rgb;
  }

  const [r, g, b] = channels;
  if (r === 0 && g === 0 && b === 0) {
    return '0 0 0';
  }

  const liftChannel = (channel: number): number => Math.round(Math.min(
    255,
    (LED_SURFACE_PAD_FLOOR * (1 - (channel / 255))) + (applyLedSurfaceGamma(channel) * LED_SURFACE_PAD_GAIN),
  ));

  return `${liftChannel(r)} ${liftChannel(g)} ${liftChannel(b)}`;
};
