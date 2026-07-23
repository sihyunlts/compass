import type { ClipNote, ColorEffectNode } from '../../shared/model';
import { DEFAULT_COLOR_PARAMS, sanitizeColorGapPercent } from './schema';

export interface ClipNoteWithOrigin extends ClipNote {
  originId?: string;
}

export interface ColorDeviceConfig {
  velocities: number[];
  noteLengthPercent: number;
  gapPercent: number;
}

const DEFAULT_COLOR_VELOCITY = DEFAULT_COLOR_PARAMS.velocities[0];
const DEFAULT_COLOR_NOTE_LENGTH_PERCENT = DEFAULT_COLOR_PARAMS.noteLengthPercent;

const sanitizeColorVelocities = (
  velocities: readonly number[],
): number[] => {
  const sanitized = velocities
    .map((slotVelocity) => Number(slotVelocity))
    .filter((slotVelocity) => Number.isFinite(slotVelocity))
    .map((slotVelocity) => Math.round(slotVelocity))
    .filter((slotVelocity) => slotVelocity >= 1 && slotVelocity <= 127);
  return sanitized.length > 0 ? sanitized : [DEFAULT_COLOR_VELOCITY];
};

const sanitizeColorNoteLengthPercent = (
  value: number,
): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? numeric
    : DEFAULT_COLOR_NOTE_LENGTH_PERCENT;
};

export const buildColorConfig = (
  effect: ColorEffectNode,
): ColorDeviceConfig => ({
  velocities: sanitizeColorVelocities(effect.params.velocities),
  noteLengthPercent: sanitizeColorNoteLengthPercent(effect.params.noteLengthPercent),
  gapPercent: sanitizeColorGapPercent(effect.params.gapPercent),
});
