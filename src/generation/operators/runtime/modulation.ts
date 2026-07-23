import {
  applyModulationRoutesToDevice,
  compileModulationProgram,
} from '../../../core/modulation/compiled-program';
import {
  cloneDeviceNode,
  type GeneratorChain,
  type GeneratorDeviceNode,
} from '../../../shared/model';
import type { ModulationContext } from './types';

export const createModulationContext = (
  modulationChain: GeneratorChain,
  loopLengthBeats: number,
): ModulationContext => ({
  loopLengthBeats,
  program: compileModulationProgram(modulationChain),
  deviceByFrameKey: new Map<string, GeneratorDeviceNode>(),
});

export const isDeviceModulated = (
  context: ModulationContext,
  deviceId: string,
): boolean => context.program.routesByTargetDeviceId.has(deviceId);

export interface ModulationEvaluationWindow {
  start: number;
  end: number;
}

const resolveEvaluationWindow = (
  context: ModulationContext,
  window: ModulationEvaluationWindow | undefined,
): ModulationEvaluationWindow => {
  if (
    window
    && Number.isFinite(window.start)
    && Number.isFinite(window.end)
    && window.end > window.start
  ) {
    return window;
  }

  return {
    start: 0,
    end: context.loopLengthBeats,
  };
};

export const resolveModulatedDeviceAtFrame = <T extends GeneratorDeviceNode>(
  context: ModulationContext,
  device: T,
  frameIndex: number,
  sampleStepBeats: number,
  evaluationWindow?: ModulationEvaluationWindow,
): T => {
  const routes = context.program.routesByTargetDeviceId.get(device.id);
  if (!routes) {
    return device;
  }

  const resolvedWindow = resolveEvaluationWindow(context, evaluationWindow);
  const evaluationLoopLengthBeats = resolvedWindow.end - resolvedWindow.start;
  const cacheKey = `${device.id}:${frameIndex}:${resolvedWindow.start}:${resolvedWindow.end}`;
  const cached = context.deviceByFrameKey.get(cacheKey);
  if (cached) {
    return cached as T;
  }

  const snapshot = cloneDeviceNode(device) as T;
  applyModulationRoutesToDevice(
    routes,
    snapshot,
    (frameIndex * sampleStepBeats) - resolvedWindow.start,
    evaluationLoopLengthBeats,
    { wrap: true },
  );
  context.deviceByFrameKey.set(cacheKey, snapshot);
  return snapshot;
};
