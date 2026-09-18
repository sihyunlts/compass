import { readNumericDeviceParam, writeNumericDeviceParam } from '../../devices/modulation';
import {
  type GeneratorChain,
  type GeneratorDeviceNode,
  type ModulationCurve,
} from '../../shared/model';
import {
  buildCurveSegments,
  evaluateCurveSegments,
  toLoopProgress01,
  type CurveSegment,
} from './curve';
import { collectValidatedModulationRoutes } from './routing';

type CompiledModulationCurve = { segments: ReadonlyArray<CurveSegment> };

interface CompiledModulationRoute {
  modulatorId: string;
  targetId: string;
  targetDeviceId: string;
  targetParamKey: string;
  amount: number;
  baseValue: number;
  curve: CompiledModulationCurve;
}

export interface CompiledModulationProgram {
  routes: ReadonlyArray<CompiledModulationRoute>;
  routesByTargetDeviceId: ReadonlyMap<string, ReadonlyArray<CompiledModulationRoute>>;
}

interface ModulationRuntimeReadout {
  modulatorId: string;
  targetId: string;
  targetDeviceId: string;
  targetParamKey: string;
  baseValue: number;
  amount: number;
  modulatedValue: number;
}

// Modulation is evaluated in its target device's local timeline. Later temporal
// stages remap the generated result, including the modulation, exactly once.
const toCompiledCurve = (curve: ModulationCurve): CompiledModulationCurve => ({
  segments: buildCurveSegments(curve.nodes),
});

export const compileModulationProgram = (
  chain: GeneratorChain,
): CompiledModulationProgram => {
  const routes = collectValidatedModulationRoutes(chain);
  const compiled: CompiledModulationRoute[] = [];
  const routesByTargetDeviceId = new Map<string, CompiledModulationRoute[]>();

  for (const route of routes) {
    const baseValue = readNumericDeviceParam(route.targetDevice, route.targetParamKey);
    if (baseValue === null) {
      continue;
    }

    const compiledRoute: CompiledModulationRoute = {
      modulatorId: route.modulator.id,
      targetId: route.target.id,
      targetDeviceId: route.targetDevice.id,
      targetParamKey: route.targetParamKey,
      amount: route.target.amount,
      baseValue,
      curve: toCompiledCurve(route.modulator.params.curve),
    };
    compiled.push(compiledRoute);

    const targetRoutes = routesByTargetDeviceId.get(compiledRoute.targetDeviceId);
    if (targetRoutes) {
      targetRoutes.push(compiledRoute);
    } else {
      routesByTargetDeviceId.set(compiledRoute.targetDeviceId, [compiledRoute]);
    }
  }

  return {
    routes: compiled,
    routesByTargetDeviceId,
  };
};

export const evaluateModulationProgramReadouts = (
  program: CompiledModulationProgram,
  beat: number,
  loopLengthBeats: number,
  options?: {
    wrap?: boolean;
  },
): ModulationRuntimeReadout[] => {
  const timelineT = toLoopProgress01(
    beat,
    loopLengthBeats,
    options?.wrap !== false,
  );
  const readouts: ModulationRuntimeReadout[] = [];

  for (const route of program.routes) {
    const curveValue = evaluateCurveSegments(route.curve.segments, timelineT);
    const modulatedValue = route.baseValue + curveValue * route.amount;

    readouts.push({
      modulatorId: route.modulatorId,
      targetId: route.targetId,
      targetDeviceId: route.targetDeviceId,
      targetParamKey: route.targetParamKey,
      baseValue: route.baseValue,
      amount: route.amount,
      modulatedValue,
    });
  }

  return readouts;
};

export const applyModulationRoutesToDevice = (
  routes: ReadonlyArray<CompiledModulationRoute>,
  targetDevice: GeneratorDeviceNode,
  beat: number,
  loopLengthBeats: number,
  options?: {
    wrap?: boolean;
  },
): void => {
  const timelineT = toLoopProgress01(
    beat,
    loopLengthBeats,
    options?.wrap !== false,
  );
  const modulationByParamKey = new Map<string, {
    baseValue: number;
    offset: number;
  }>();

  for (const route of routes) {
    const curveValue = evaluateCurveSegments(route.curve.segments, timelineT);
    const accumulated = modulationByParamKey.get(route.targetParamKey) ?? {
      baseValue: route.baseValue,
      offset: 0,
    };
    accumulated.offset += curveValue * route.amount;
    modulationByParamKey.set(route.targetParamKey, accumulated);
  }

  for (const [paramKey, modulation] of modulationByParamKey) {
    writeNumericDeviceParam(
      targetDevice,
      paramKey,
      modulation.baseValue + modulation.offset,
    );
  }
};
