import { SvelteMap } from 'svelte/reactivity';

import {
  type CompiledModulationProgram,
  compileModulationProgram,
  evaluateModulationProgramReadouts,
} from '../../../core/modulation/compiled-program';
import { getNumericParameterRule } from '../../../devices/registry-core';
import {
  formatNumericParameterDisplayValue,
  formatNumericParameterValue,
} from '../../../devices/numeric-parameters';
import { clamp } from '../../../shared/math';
import type { GeneratorChain } from '../../../shared/model';
import { LatestSourceKeyFamilyCache } from './source-key-cache';
import { toWrappedLoopBeat01 } from './utils';

const EMPTY_MODULATION_READOUT_BY_ID: Readonly<Record<string, string>> = Object.freeze({});

interface ModulationCacheEntry {
  key: string;
  program: CompiledModulationProgram;
  baselineById: Readonly<Record<string, string>>;
  modulatorIds: readonly string[];
}

class ModulationReadoutCache {
  private readonly modulationCacheByKey = new SvelteMap<string, ModulationCacheEntry>();

  private readonly latestSourceKeyByFamily = new LatestSourceKeyFamilyCache();

  public resolveReadoutById(
    sourceKey: string,
    chain: GeneratorChain,
    beat: number,
    loopLengthBeats: number,
    isLoopEnabled: boolean,
  ): Readonly<Record<string, string>> {
    const modulationCache = this.resolveCache(sourceKey, chain);
    if (modulationCache.modulatorIds.length === 0) {
      return EMPTY_MODULATION_READOUT_BY_ID;
    }

    const modulationBeat01 = isLoopEnabled
      ? toWrappedLoopBeat01(beat)
      : clamp(beat, 0, 1);
    const readoutById = {
      ...modulationCache.baselineById,
    };

    const readouts = evaluateModulationProgramReadouts(
      modulationCache.program,
      modulationBeat01,
      loopLengthBeats,
      { wrap: isLoopEnabled },
    );
    const readoutSegmentsByModulatorId = new Map<string, string[]>();
    const targetDeviceKindById = new Map(
      chain.devices.map((device) => [device.id, device.kind] as const),
    );
    for (const readout of readouts) {
      const segments = readoutSegmentsByModulatorId.get(readout.modulatorId) ?? [];
      const targetKind = targetDeviceKindById.get(readout.targetDeviceId);
      const parameterRule = targetKind
        ? getNumericParameterRule(targetKind, readout.targetParamKey)
        : null;
      const valueText = readout.modulatedValue.toFixed(3);
      const formattedValue = parameterRule
        ? formatNumericParameterDisplayValue(
            parameterRule,
            readout.modulatedValue,
            valueText,
          )
        : formatNumericParameterValue(valueText, undefined);
      const parameterLabel = parameterRule?.modulationLabel ?? readout.targetParamKey;
      segments.push(`${parameterLabel} ${formattedValue}`);
      readoutSegmentsByModulatorId.set(readout.modulatorId, segments);
    }

    for (const [modulatorId, segments] of readoutSegmentsByModulatorId.entries()) {
      readoutById[modulatorId] = segments.length === 1
        ? `Current ${segments[0]}`
        : `${segments.length} targets | ${segments.join(' | ')}`;
    }

    return readoutById;
  }

  private resolveCache(
    sourceKey: string,
    chain: GeneratorChain,
  ): ModulationCacheEntry {
    this.evictStaleSourceFamilyEntries(sourceKey);
    const cached = this.modulationCacheByKey.get(sourceKey);
    if (cached) {
      return cached;
    }

    const modulatorIds = chain.devices
      .filter((device) => device.kind === 'modulator')
      .map((device) => device.id);
    const baselineById: Record<string, string> = {};
    for (const modulatorId of modulatorIds) {
      baselineById[modulatorId] = 'No valid target';
    }

    const entry: ModulationCacheEntry = {
      key: sourceKey,
      program: compileModulationProgram(chain),
      baselineById,
      modulatorIds,
    };
    this.modulationCacheByKey.set(sourceKey, entry);
    return entry;
  }

  public reset(): void {
    this.modulationCacheByKey.clear();
    this.latestSourceKeyByFamily.reset();
  }

  private evictStaleSourceFamilyEntries(sourceKey: string): void {
    this.latestSourceKeyByFamily.evictStaleEntries(sourceKey, (staleSourceKey) => {
      this.modulationCacheByKey.delete(staleSourceKey);
    });
  }
}

export const createModulationReadoutCache = (): ModulationReadoutCache =>
  new ModulationReadoutCache();
