import { SvelteMap } from 'svelte/reactivity';

import type { ModulationParameterState } from '../../../shared/contracts/preview/modulation';

const activeTargetKeyByParameter = new SvelteMap<string, string>();

export const createModulationDisplayTargetKey = (
  state: Pick<ModulationParameterState, 'modulatorId' | 'targetId'>,
): string => `${state.modulatorId}:${state.targetId}`;

export const activateModulationDisplayTarget = (
  parameterKey: string,
  state: Pick<ModulationParameterState, 'modulatorId' | 'targetId'>,
): void => {
  if (!parameterKey) {
    return;
  }
  activeTargetKeyByParameter.set(parameterKey, createModulationDisplayTargetKey(state));
};

export const getActiveModulationDisplayTargetKey = (
  parameterKey: string,
): string | undefined => activeTargetKeyByParameter.get(parameterKey);

export const retainModulationDisplayTargets = (
  parameterKeys: ReadonlySet<string>,
): void => {
  for (const parameterKey of activeTargetKeyByParameter.keys()) {
    if (!parameterKeys.has(parameterKey)) {
      activeTargetKeyByParameter.delete(parameterKey);
    }
  }
};

export const resetModulationDisplayTargets = (): void => {
  activeTargetKeyByParameter.clear();
};

export const resolveDisplayedModulationStates = (
  parameterKey: string,
  states: readonly ModulationParameterState[],
): readonly ModulationParameterState[] => {
  const activeTargetKey = getActiveModulationDisplayTargetKey(parameterKey);
  const activeState = states.find(
    (state) => createModulationDisplayTargetKey(state) === activeTargetKey,
  );
  return activeState
    ? [activeState]
    : states.length > 0
      ? [states[states.length - 1]]
      : [];
};
