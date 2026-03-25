import type { TemporalVisibilityWindow, SceneInstance } from '../core-types';
import { SAMPLES_PER_BEAT } from './constants';
import type { ButtonIndex } from './types';
import { projectSceneToActivationFrame } from './active';

const hasVisibleOutput = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  buttonIndex: ButtonIndex,
  beat01: number,
): boolean => {
  const frame = projectSceneToActivationFrame(sceneInstances, beat01, buttonIndex);
  return frame.activeTiles.size > 0 || frame.activeByPitch.size > 0;
};

export const sampleNaturalActiveWindow = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  buttonIndex: ButtonIndex,
): TemporalVisibilityWindow | null => {
  if (sceneInstances.length === 0) {
    return null;
  }

  let firstActiveBeat = Number.POSITIVE_INFINITY;
  let lastActiveBeat = Number.NEGATIVE_INFINITY;
  for (let sampleIndex = 0; sampleIndex < SAMPLES_PER_BEAT; sampleIndex += 1) {
    const sampleBeat = sampleIndex / SAMPLES_PER_BEAT;
    if (!hasVisibleOutput(sceneInstances, buttonIndex, sampleBeat)) {
      continue;
    }

    firstActiveBeat = Math.min(firstActiveBeat, sampleBeat);
    lastActiveBeat = Math.max(lastActiveBeat, sampleBeat + 1 / SAMPLES_PER_BEAT);
  }

  if (!Number.isFinite(firstActiveBeat) || !Number.isFinite(lastActiveBeat) || lastActiveBeat <= firstActiveBeat) {
    return null;
  }

  return {
    start: firstActiveBeat,
    end: Math.min(1, lastActiveBeat),
  };
};
