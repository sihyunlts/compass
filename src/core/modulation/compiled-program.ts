import { doesDeviceToggleTimelineParity } from '../../devices/engine';
import type {
  CurveNode,
  GeneratorChain,
  GeneratorDeviceNode,
} from '../../shared/types';
import { readNumericDeviceParam, writeNumericDeviceParam } from '../../shared/device-registry';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import { clamp } from '../../shared/math';
import { toLoopProgress01 } from './curve';
import { collectValidatedModulationRoutes } from './routing';

export type CompiledModulationCurve = { nodes: ReadonlyArray<CurveNode> };

export interface CompiledModulationRoute {
  modulatorId: string;
  targetDeviceId: string;
  targetParamKey: string;
  amount: number;
  baseValue: number;
  curve: CompiledModulationCurve;
  isTimelineReversed: boolean;
}

export interface CompiledModulationProgram {
  routes: ReadonlyArray<CompiledModulationRoute>;
}

export interface ModulationRuntimeReadout {
  modulatorId: string;
  targetDeviceId: string;
  targetParamKey: string;
  baseValue: number;
  curveValue: number;
  amount: number;
  modulatedValue: number;
}

const resolveReversedTimelineByDeviceId = (
  chain: GeneratorChain,
): Map<string, boolean> => {
  const deviceIndexById = new Map<string, number>();
  const reverseIndices: number[] = [];

  for (let index = 0; index < chain.devices.length; index += 1) {
    const device = chain.devices[index];
    if (!deviceIndexById.has(device.id)) {
      deviceIndexById.set(device.id, index);
    }
    if (doesDeviceToggleTimelineParity(device) && isDeviceEffectivelyEnabled(chain, device)) {
      reverseIndices.push(index);
    }
  }

  if (reverseIndices.length === 0) {
    return new Map<string, boolean>();
  }

  const reversedById = new Map<string, boolean>();
  for (const [deviceId, index] of deviceIndexById.entries()) {
    let reverseCount = 0;
    for (const reverseIndex of reverseIndices) {
      if (reverseIndex > index) {
        reverseCount += 1;
      }
    }
    reversedById.set(deviceId, reverseCount % 2 === 1);
  }

  return reversedById;
};

const reverseLoopProgress01 = (t01: number): number => {
  if (!Number.isFinite(t01)) {
    return 0;
  }
  if (t01 <= 0) {
    return 1;
  }
  return 1 - t01;
};

const toCompiledCurve = (nodes: ReadonlyArray<CurveNode>): CompiledModulationCurve => ({
  nodes: nodes.map((node) => ({ ...node })),
});

export const compileModulationProgram = (
  chain: GeneratorChain,
): CompiledModulationProgram => {
  const routes = collectValidatedModulationRoutes(chain);
  const reversedTimelineByDeviceId = resolveReversedTimelineByDeviceId(chain);
  const compiled: CompiledModulationRoute[] = [];

  for (const route of routes) {
    const baseValue = readNumericDeviceParam(route.targetDevice, route.targetParamKey);
    if (baseValue === null) {
      continue;
    }

    compiled.push({
      modulatorId: route.modulator.id,
      targetDeviceId: route.targetDevice.id,
      targetParamKey: route.targetParamKey,
      amount: route.modulator.params.amount,
      baseValue,
      curve: toCompiledCurve(route.modulator.params.curve.nodes),
      isTimelineReversed: reversedTimelineByDeviceId.get(route.targetDevice.id) === true,
    });
  }

  return {
    routes: compiled,
  };
};

const evaluateCompiledCurveLinear = (
  curve: CompiledModulationCurve,
  t01: number,
): number => {
  const nodes = curve.nodes;
  if (nodes.length === 0) {
    return 0;
  }

  const t = clamp(Number.isFinite(t01) ? t01 : 0, 0, 1);
  if (t <= nodes[0].t) {
    return nodes[0].v;
  }

  const last = nodes[nodes.length - 1];
  if (t >= last.t) {
    return last.v;
  }

  for (let index = 1; index < nodes.length; index += 1) {
    const right = nodes[index];
    if (t > right.t) {
      continue;
    }
    const left = nodes[index - 1];
    const span = Math.max(right.t - left.t, 1e-9);
    const ratio = (t - left.t) / span;
    return left.v + (right.v - left.v) * ratio;
  }

  return last.v;
};

export const evaluateModulationProgramReadouts = (
  program: CompiledModulationProgram,
  beat01: number,
  loopLengthBeats: number,
  options?: {
    wrap?: boolean;
  },
): ModulationRuntimeReadout[] => {
  const baseTimelineT = toLoopProgress01(
    beat01,
    loopLengthBeats,
    options?.wrap !== false,
  );
  const readouts: ModulationRuntimeReadout[] = [];

  for (const route of program.routes) {
    const timelineT = route.isTimelineReversed
      ? reverseLoopProgress01(baseTimelineT)
      : baseTimelineT;
    const curveValue = evaluateCompiledCurveLinear(route.curve, timelineT);
    const modulatedValue = route.baseValue + curveValue * route.amount;

    readouts.push({
      modulatorId: route.modulatorId,
      targetDeviceId: route.targetDeviceId,
      targetParamKey: route.targetParamKey,
      baseValue: route.baseValue,
      curveValue,
      amount: route.amount,
      modulatedValue,
    });
  }

  return readouts;
};

export const applyModulationProgramToChain = (
  program: CompiledModulationProgram,
  targetChainWithoutModulators: GeneratorChain,
  deviceById: Map<string, GeneratorDeviceNode>,
  beat01: number,
  loopLengthBeats: number,
  options?: {
    wrap?: boolean;
  },
): void => {
  if (targetChainWithoutModulators.devices.length === 0) {
    return;
  }

  const baseTimelineT = toLoopProgress01(
    beat01,
    loopLengthBeats,
    options?.wrap !== false,
  );

  for (const route of program.routes) {
    const targetDevice = deviceById.get(route.targetDeviceId);
    if (!targetDevice) {
      continue;
    }

    const timelineT = route.isTimelineReversed
      ? reverseLoopProgress01(baseTimelineT)
      : baseTimelineT;
    const curveValue = evaluateCompiledCurveLinear(route.curve, timelineT);
    const modulatedValue = route.baseValue + curveValue * route.amount;
    writeNumericDeviceParam(targetDevice, route.targetParamKey, modulatedValue);
  }
};
