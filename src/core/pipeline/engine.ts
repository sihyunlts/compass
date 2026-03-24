import { cloneDeviceNode, type GeneratorChain, type GeneratorDeviceNode, type GeneratorNode, type LaunchpadButton } from '../../shared/model';
import type { Bounds, Polyline, SceneInstance } from '../core-types';
import {
  applyModulationProgramToChain,
  compileModulationProgram,
  type CompiledModulationProgram,
} from '../modulation/compiled-program';
import {
  stripModulationDevicesFromChain,
} from '../modulation/routing';
import {
  projectSceneToExactOutputFrame,
  type ExactOutputFrame,
  type OverlayFrameStroke,
  type ActivationFrame,
} from './active';
import { buildButtonIndex } from './buttons';
import {
  buildWorldBounds,
} from './constants';
import {
  isGeneratorNode,
  resolveMutedSources,
  splitChainByGroup,
} from './groups';
import {
  buildPolylinesForAllGroups,
  buildSceneInstancesForAllGroups,
  evaluateMaskDebugSnapshot,
  type MaskDebugSnapshot,
} from './polylines';
import type { ButtonIndex, GroupChain, GroupEvaluationContext, GroupId } from './types';

export interface CompiledPipelineEngine {
  buttons: ReadonlyArray<LaunchpadButton>;
  buttonIndex: ButtonIndex;
  worldBounds: Bounds;
  chainWithoutModulators: GeneratorChain;
  deviceById: Map<string, GeneratorDeviceNode>;
  groupChains: GroupChain[];
  groupById: Map<GroupId, GroupChain>;
  generatorById: Map<string, GeneratorNode>;
  mutedGroupIds: Set<string>;
  mutedGeneratorIds: Set<string>;
  modulation: CompiledModulationProgram;
}

export type { MaskDebugSnapshot } from './polylines';
export type { ActivationFrame, ExactOutputFrame, OverlayFrameStroke } from './active';

interface CompilePipelineEngineOptions {
  buttons?: ReadonlyArray<LaunchpadButton>;
  buttonIndex?: ButtonIndex;
  worldBounds?: Bounds;
}

const EMPTY_BUTTON_INDEX: ButtonIndex = {
  groups: [],
};

const cloneChainWithoutModulators = (sourceChain: GeneratorChain): GeneratorChain => {
  const stripped = stripModulationDevicesFromChain(sourceChain);
  return {
    devices: stripped.devices.map((device) => cloneDeviceNode(device)),
    groupStateById: { ...stripped.groupStateById },
  };
};

const buildDeviceById = (
  chain: GeneratorChain,
): Map<string, GeneratorDeviceNode> => new Map(
  chain.devices.map((device) => [device.id, device]),
);

const buildGeneratorById = (
  chain: GeneratorChain,
): Map<string, GeneratorNode> => {
  const generatorById = new Map<string, GeneratorNode>();
  for (const device of chain.devices) {
    if (isGeneratorNode(device)) {
      generatorById.set(device.id, device);
    }
  }
  return generatorById;
};

const buildGroupById = (
  groupChains: ReadonlyArray<GroupChain>,
): Map<GroupId, GroupChain> => {
  const groupById = new Map<GroupId, GroupChain>();
  for (const group of groupChains) {
    groupById.set(group.id, group);
  }
  return groupById;
};

export const compilePipelineEngine = (
  sourceChain: GeneratorChain,
  options?: CompilePipelineEngineOptions,
): CompiledPipelineEngine => {
  const buttons = options?.buttons ?? [];
  const worldBounds = options?.worldBounds ?? buildWorldBounds();
  const buttonIndex = options?.buttonIndex
    ?? (options?.buttons !== undefined ? buildButtonIndex(options.buttons) : EMPTY_BUTTON_INDEX);
  const chainWithoutModulators = cloneChainWithoutModulators(sourceChain);
  const groupChains = splitChainByGroup(chainWithoutModulators);
  const groupById = buildGroupById(groupChains);
  const { mutedGroupIds, mutedGeneratorIds } = resolveMutedSources(chainWithoutModulators);

  return {
    buttons,
    buttonIndex,
    worldBounds,
    chainWithoutModulators,
    deviceById: buildDeviceById(chainWithoutModulators),
    groupChains,
    groupById,
    generatorById: buildGeneratorById(chainWithoutModulators),
    mutedGroupIds,
    mutedGeneratorIds,
    modulation: compileModulationProgram(sourceChain),
  };
};

const createEvaluationContext = (
  engine: CompiledPipelineEngine,
  time: number,
): GroupEvaluationContext => ({
  time,
  timeReversed: 1 - time,
  buttonIndex: engine.buttonIndex,
  chain: engine.chainWithoutModulators,
  groupStateById: engine.chainWithoutModulators.groupStateById,
  worldBounds: engine.worldBounds,
  groupChains: engine.groupChains,
  groupById: engine.groupById,
  generatorById: engine.generatorById,
  mutedGroupIds: engine.mutedGroupIds,
  mutedGeneratorIds: engine.mutedGeneratorIds,
  cache: {
    sceneInstancesByGroup: new Map(),
    outputPolylinesByGroup: new Map(),
  },
});

const prepareEvaluationContext = (
  engine: CompiledPipelineEngine,
  time01: number,
): GroupEvaluationContext => {
  applyModulationProgramToChain(
    engine.modulation,
    engine.chainWithoutModulators,
    engine.deviceById,
    time01,
    1,
    { wrap: true },
  );

  return createEvaluationContext(engine, time01);
};

export const evaluateSceneInstancesAtTime = (
  engine: CompiledPipelineEngine,
  time01: number,
): SceneInstance[] => {
  const context = prepareEvaluationContext(engine, time01);
  return buildSceneInstancesForAllGroups(context);
};

export const evaluatePolylinesAtTime = (
  engine: CompiledPipelineEngine,
  time01: number,
): Polyline[] => {
  const context = prepareEvaluationContext(engine, time01);
  return buildPolylinesForAllGroups(context);
};

export const evaluateExactOutputFrameAtTime = (
  engine: CompiledPipelineEngine,
  time01: number,
  bounds?: Bounds,
): ExactOutputFrame => {
  const scene = evaluateSceneInstancesAtTime(engine, time01);
  return projectSceneToExactOutputFrame(scene, time01, engine.buttonIndex, bounds);
};

export const evaluateExactOutputFramesAtTimes = (
  engine: CompiledPipelineEngine,
  times01: ReadonlyArray<number>,
  bounds?: Bounds,
): ExactOutputFrame[] => times01.map((time01) =>
  evaluateExactOutputFrameAtTime(engine, time01, bounds));

export const evaluateMaskDebugAtTime = (
  engine: CompiledPipelineEngine,
  maskDeviceId: string,
  time01: number,
): MaskDebugSnapshot | null => {
  const context = prepareEvaluationContext(engine, time01);
  return evaluateMaskDebugSnapshot(maskDeviceId, context);
};
