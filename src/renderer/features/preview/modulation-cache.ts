import { SvelteMap } from 'svelte/reactivity';

import {
  type CompiledModulationProgram,
  compileModulationProgram,
  evaluateModulationProgramReadouts,
} from '../../../core/modulation/compiled-program';
import { clamp } from '../../../shared/math';
import type { GeneratorChain } from '../../../shared/model';
import { toWrappedLoopBeat01 } from './utils';

const EMPTY_MODULATION_READOUT_BY_ID: Readonly<Record<string, string>> = Object.freeze({});

export interface ModulationCacheEntry {
  key: string;
  program: CompiledModulationProgram;
  baselineById: Readonly<Record<string, string>>;
  modulatorIds: readonly string[];
}

class ModulationReadoutCache {
  private readonly modulationCacheByKey = new SvelteMap<string, ModulationCacheEntry>();

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
    for (const readout of readouts) {
      readoutById[readout.modulatorId] = [
        `${readout.targetParamKey}`,
        `Current ${readout.modulatedValue.toFixed(3)}`,
        `Base ${readout.baseValue.toFixed(3)}`,
      ].join(' | ');
    }

    return readoutById;
  }

  private resolveCache(
    sourceKey: string,
    chain: GeneratorChain,
  ): ModulationCacheEntry {
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
}

export const createModulationReadoutCache = (): ModulationReadoutCache =>
  new ModulationReadoutCache();
