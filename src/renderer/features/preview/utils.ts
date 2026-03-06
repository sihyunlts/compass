import { SvelteMap } from 'svelte/reactivity';

import type { GeneratorPreview } from '../../../shared/contracts/preview/generator-preview';
import type { PreviewWindowState } from '../../../shared/contracts/preview/window-state';

export const EMPTY_ACTIVE_VELOCITY_BY_PITCH = new SvelteMap<number, number>();

export const resolveSourceTimelineEnd = (
  preview: GeneratorPreview | null,
): number => {
  if (!preview) {
    return 1;
  }

  let maxEndBeat = 1;
  for (const note of preview.notes) {
    const startBeat = Number.isFinite(note.startBeat) ? note.startBeat : 0;
    const durationBeats = Number.isFinite(note.durationBeats) ? note.durationBeats : 0;
    const endBeat = Math.max(0, startBeat + Math.max(durationBeats, 0));
    if (endBeat > maxEndBeat) {
      maxEndBeat = endBeat;
    }
  }

  return Number.isFinite(maxEndBeat) && maxEndBeat >= 1 ? maxEndBeat : 1;
};

export const collectActiveVelocityByPitch = (
  preview: GeneratorPreview | null,
  beat: number,
): SvelteMap<number, number> => {
  const active = new SvelteMap<number, number>();

  if (!preview) {
    return active;
  }

  for (const note of preview.notes) {
    const startBeat = note.startBeat;
    const endBeat = note.startBeat + note.durationBeats;
    if (beat < startBeat || beat >= endBeat) {
      continue;
    }

    const previous = active.get(note.pitch);
    if (previous === undefined || note.velocity > previous) {
      active.set(note.pitch, note.velocity);
    }
  }

  return active;
};

export const toWrappedLoopBeat01 = (beat: number): number => {
  const safeBeat = Number.isFinite(beat) ? beat : 0;
  const wrapped = ((safeBeat % 1) + 1) % 1;
  if (wrapped === 0 && safeBeat > 0) {
    return 1;
  }
  return wrapped;
};

export const toActiveCells = (
  activeVelocityByPitch: ReadonlyMap<number, number>,
  resolveLedRgb: (velocity: number) => string,
): PreviewWindowState['activeCells'] => {
  const activeCells: PreviewWindowState['activeCells'] = [];
  for (const [pitch, velocity] of activeVelocityByPitch.entries()) {
    activeCells.push({
      pitch,
      rgb: resolveLedRgb(velocity),
    });
  }
  return activeCells;
};
