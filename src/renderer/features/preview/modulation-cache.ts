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
import type { GeneratorChain } from '../../../shared/model';
import { LatestSourceKeyFamilyCache } from './source-key-cache';
import { i18n } from '../../i18n.svelte';

const EMPTY_MODULATION_READOUT_BY_ID: Readonly<Record<string, string>> = Object.freeze({});

interface ModulationCacheEntry {
  key: string;
  program: CompiledModulationProgram;
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

    const readoutById = Object.fromEntries(
      modulationCache.modulatorIds.map((modulatorId) => [
        modulatorId,
        i18n.t('modulation.noValidTarget'),
      ]),
    );

    const readouts = evaluateModulationProgramReadouts(
      modulationCache.program,
      beat,
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
      const parameterLabel = parameterRule?.modulationMessageKey
        ? i18n.t(parameterRule.modulationMessageKey)
        : readout.targetParamKey;
      segments.push(`${parameterLabel} ${formattedValue}`);
      readoutSegmentsByModulatorId.set(readout.modulatorId, segments);
    }

    for (const [modulatorId, segments] of readoutSegmentsByModulatorId.entries()) {
      readoutById[modulatorId] = segments.length === 1
        ? i18n.t('modulation.current', { target: segments[0] })
        : `${i18n.t('modulation.targetCount', { count: segments.length })} | ${segments.join(' | ')}`;
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
    const entry: ModulationCacheEntry = {
      key: sourceKey,
      program: compileModulationProgram(chain),
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
