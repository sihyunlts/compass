import {
  applyModulationProgramToChain,
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

export const resolveModulatedDeviceAtFrame = <T extends GeneratorDeviceNode>(
  context: ModulationContext,
  device: T,
  frameIndex: number,
  sampleStepBeats: number,
  evaluationLoopLengthBeats = context.loopLengthBeats,
): T => {
  if (context.program.routes.length === 0) {
    return device;
  }

  const cacheKey = `${device.id}:${frameIndex}:${evaluationLoopLengthBeats}`;
  const cached = context.deviceByFrameKey.get(cacheKey);
  if (cached) {
    return cached as T;
  }

  const snapshot = cloneDeviceNode(device) as T;
  applyModulationProgramToChain(
    context.program,
    {
      devices: [snapshot],
      groupStateById: {},
    },
    new Map<string, GeneratorDeviceNode>([[snapshot.id, snapshot]]),
    frameIndex * sampleStepBeats,
    evaluationLoopLengthBeats,
    { wrap: true },
  );
  context.deviceByFrameKey.set(cacheKey, snapshot);
  return snapshot;
};
