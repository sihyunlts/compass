import { cloneDeviceNode, type GeneratorChain, type GeneratorDeviceNode, type GeneratorNode, type LaunchpadButton } from '../../shared/model';
import type { Bounds, Polyline } from '../core-types';
import {
  applyModulationProgramToChain,
  compileModulationProgram,
  type CompiledModulationProgram,
} from '../modulation/compiled-program';
import {
  stripModulationDevicesFromChain,
} from '../modulation/routing';
import { resolveActiveByPitch } from './active';
import { buildButtonIndex } from './buttons';
import {
  SAMPLES_PER_BEAT,
  THICKNESS,
  buildWorldBounds,
} from './constants';
import {
  isGeneratorNode,
  resolveMutedSources,
  splitChainByGroup,
} from './groups';
import { distanceToPolylineSquared } from '../geometry';
import { buildPolylinesForAllGroups, evaluateMaskDebugSnapshot, type MaskDebugSnapshot } from './polylines';
import type {
  ActivePitchInfo,
  ButtonIndex,
  GroupChain,
  GroupEvaluationContext,
  GroupId,
  OriginWindow,
} from './types';

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

interface CompilePipelineEngineOptions {
  buttons?: ReadonlyArray<LaunchpadButton>;
  buttonIndex?: ButtonIndex;
  worldBounds?: Bounds;
}

const EMPTY_BUTTON_INDEX: ButtonIndex = {
  groups: [],
  coordinates: [],
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
  originWindows?: Map<string, OriginWindow>,
): GroupEvaluationContext => ({
  time,
  timeReversed: 1 - time,
  buttonIndex: engine.buttonIndex,
  chain: engine.chainWithoutModulators,
  groupStateById: engine.chainWithoutModulators.groupStateById,
  worldBounds: engine.worldBounds,
  originWindows,
  groupChains: engine.groupChains,
  groupById: engine.groupById,
  generatorById: engine.generatorById,
  mutedGroupIds: engine.mutedGroupIds,
  mutedGeneratorIds: engine.mutedGeneratorIds,
  cache: {
    layersByGroup: new Map(),
    sourcePolylinesByGroup: new Map(),
    sourcePolylinesByGroupReversed: new Map(),
    resolvingSourcePolylinesByGroup: new Set(),
    resolvingSourcePolylinesByGroupReversed: new Set(),
    sourceColorGuideWarpByGroup: new Map(),
    outputPolylinesByGroup: new Map(),
  },
});

export const evaluatePolylinesAtTime = (
  engine: CompiledPipelineEngine,
  time01: number,
  originWindows?: Map<string, OriginWindow>,
): Polyline[] => {
  applyModulationProgramToChain(
    engine.modulation,
    engine.chainWithoutModulators,
    engine.deviceById,
    time01,
    1,
    { wrap: true },
  );

  const context = createEvaluationContext(engine, time01, originWindows);
  return buildPolylinesForAllGroups(context);
};

export const evaluateActiveByPitchAtTime = (
  engine: CompiledPipelineEngine,
  time01: number,
  originWindows?: Map<string, OriginWindow>,
): Map<number, ActivePitchInfo> => {
  const polylines = evaluatePolylinesAtTime(engine, time01, originWindows);
  return resolveActiveByPitch(polylines, engine.buttonIndex);
};

export const evaluateMaskDebugAtTime = (
  engine: CompiledPipelineEngine,
  maskDeviceId: string,
  time01: number,
  originWindows?: Map<string, OriginWindow>,
): MaskDebugSnapshot | null => {
  applyModulationProgramToChain(
    engine.modulation,
    engine.chainWithoutModulators,
    engine.deviceById,
    time01,
    1,
    { wrap: true },
  );

  const context = createEvaluationContext(engine, time01, originWindows);
  return evaluateMaskDebugSnapshot(maskDeviceId, context);
};

export const computeOriginWindowsWithEngine = (
  engine: CompiledPipelineEngine,
  loopLengthBeats: number,
): Map<string, OriginWindow> => {
  const steps = Math.round(loopLengthBeats * SAMPLES_PER_BEAT);
  if (!Number.isFinite(steps) || steps <= 0) {
    return new Map();
  }

  const windows = new Map<string, OriginWindow>();
  const thicknessSq = THICKNESS * THICKNESS;

  for (let step = 0; step < steps; step += 1) {
    const t = step / steps;
    const polylines = evaluatePolylinesAtTime(engine, t);
    const activeOrigins = new Set<string>();

    for (const coord of engine.buttonIndex.coordinates) {
      for (const polyline of polylines) {
        if (polyline.mask && !polyline.mask(coord.x, coord.y)) {
          continue;
        }
        const distanceSq = distanceToPolylineSquared(coord, polyline);
        if (distanceSq <= thicknessSq) {
          activeOrigins.add(polyline.originId);
        }
      }
    }

    for (const originId of activeOrigins) {
      const existing = windows.get(originId);
      if (!existing) {
        windows.set(originId, { min: t, max: t });
      } else {
        existing.min = Math.min(existing.min, t);
        existing.max = Math.max(existing.max, t);
      }
    }
  }

  return windows;
};
