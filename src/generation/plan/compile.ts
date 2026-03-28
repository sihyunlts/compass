import { buildCanonicalAnalysisResult } from '../analysis/operators';
import { compileModulationProgram } from '../../core/modulation/compiled-program';
import { stripModulationDevicesFromChain } from '../../core/modulation/routing';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import { cloneDeviceNode } from '../../shared/model';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type { GeneratorChain } from '../../shared/model';
import type { CompiledRackPlan, CompiledRackStage } from './types';

const buildStageId = (
  stageIndex: number,
  deviceId: string,
): string => `stage:${stageIndex}:${deviceId}`;

const stableStringify = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'null';
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }

  return 'null';
};

const buildStageReuseSignature = (
  stage: CompiledRackStage,
): string => stableStringify({
  id: stage.device.id,
  kind: stage.device.kind,
  groupId: stage.groupId,
  params: 'params' in stage.device ? stage.device.params : null,
});

const buildModulationSignature = (
  chain: GeneratorChain,
): string => {
  const program = compileModulationProgram(chain);
  return stableStringify(program.routes.map((route) => ({
    targetDeviceId: route.targetDeviceId,
    targetParamKey: route.targetParamKey,
    amount: route.amount,
    baseValue: route.baseValue,
    curve: route.curve,
    isTimelineReversed: route.isTimelineReversed,
  })));
};

export const buildCompiledRackPlan = (
  chain: GeneratorChain,
  loopLengthBeats: number,
): CompiledRackPlan => {
  void loopLengthBeats;
  const baseChain = stripModulationDevicesFromChain(chain);
  const stages: CompiledRackStage[] = [];

  for (const device of baseChain.devices) {
    if (!isDeviceEffectivelyEnabled(baseChain, device) || device.kind === 'modulator') {
      continue;
    }

    const stageIndex = stages.length;
    const stage: CompiledRackStage = {
      stageId: buildStageId(stageIndex, device.id),
      stageIndex,
      deviceId: device.id,
      deviceKind: device.kind,
      groupId: normalizeOptionalId(device.groupId),
      device: cloneDeviceNode(device),
      reuseSignature: '',
    };
    stage.reuseSignature = buildStageReuseSignature(stage);
    stages.push(stage);
  }

  return {
    stages,
    baseChain,
    analysis: buildCanonicalAnalysisResult(baseChain),
    modulationSignature: buildModulationSignature(chain),
  };
};
