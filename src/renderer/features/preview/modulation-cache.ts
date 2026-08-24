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
import { LatestSourceKeyFamilyCache } from '../../../shared/source-key-family';
import {
  createModulationParameterKey,
  type ModulationParameterState,
  type ModulationStateByParameter,
} from '../../../shared/contracts/preview/modulation';
import {
  activateModulationDisplayTarget,
  createModulationDisplayTargetKey,
  getActiveModulationDisplayTargetKey,
  retainModulationDisplayTargets,
  resetModulationDisplayTargets,
} from './modulation-display-selection.svelte';
import { i18n } from '../../i18n.svelte';
import { getDeviceMessageKey } from '../../device-i18n';
import { buildDeviceDisplayNameById } from '../rack/display-names';

const EMPTY_MODULATION_READOUT_BY_ID: Readonly<Record<string, string>> = Object.freeze({});
const EMPTY_MODULATION_STATE_BY_PARAMETER: ModulationStateByParameter = Object.freeze({});

interface ModulationCacheResult {
  readoutById: Readonly<Record<string, string>>;
  stateByParameter: ModulationStateByParameter;
}

interface ModulationCacheEntry {
  key: string;
  program: CompiledModulationProgram;
  modulatorIds: readonly string[];
}

class ModulationReadoutCache {
  private readonly modulationCacheByKey = new SvelteMap<string, ModulationCacheEntry>();

  private readonly latestSourceKeyByFamily = new LatestSourceKeyFamilyCache();

  private readonly amountByTargetKey = new Map<string, number>();

  private readonly curveSignatureByModulatorId = new Map<string, string>();

  private displaySelectionSourceKey: string | null = null;

  public resolveReadoutById(
    sourceKey: string,
    chain: GeneratorChain,
    beat: number,
    loopLengthBeats: number,
    isLoopEnabled: boolean,
  ): ModulationCacheResult {
    const modulationCache = this.resolveCache(sourceKey, chain);
    if (modulationCache.modulatorIds.length === 0) {
      this.resetDisplaySelection();
      return {
        readoutById: EMPTY_MODULATION_READOUT_BY_ID,
        stateByParameter: EMPTY_MODULATION_STATE_BY_PARAMETER,
      };
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
    const stateByParameter = new Map<string, ModulationParameterState[]>();
    const targetDeviceKindById = new Map(
      chain.devices.map((device) => [device.id, device.kind] as const),
    );
    const modulatorLabelById = buildDeviceDisplayNameById(
      chain.devices,
      (kind) => i18n.t(getDeviceMessageKey(kind)),
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

      const parameterKey = createModulationParameterKey(
        readout.targetDeviceId,
        readout.targetParamKey,
      );
      const states = stateByParameter.get(parameterKey) ?? [];
      states.push({
        targetId: readout.targetId,
        modulatorId: readout.modulatorId,
        modulatorLabel: modulatorLabelById[readout.modulatorId] ?? readout.modulatorId,
        baseValue: readout.baseValue,
        amount: readout.amount,
        modulatedValue: readout.modulatedValue,
      });
      stateByParameter.set(parameterKey, states);
    }

    this.resolveDisplaySelection(sourceKey, chain, stateByParameter);

    for (const [modulatorId, segments] of readoutSegmentsByModulatorId.entries()) {
      readoutById[modulatorId] = segments.length === 1
        ? i18n.t('modulation.current', { target: segments[0] })
        : `${i18n.t('modulation.targetCount', { count: segments.length })} | ${segments.join(' | ')}`;
    }

    return {
      readoutById,
      stateByParameter: Object.fromEntries(stateByParameter),
    };
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
    this.resetDisplaySelection();
  }

  private resolveDisplaySelection(
    sourceKey: string,
    chain: GeneratorChain,
    stateByParameter: ReadonlyMap<string, ModulationParameterState[]>,
  ): void {
    if (sourceKey === this.displaySelectionSourceKey) {
      return;
    }
    this.displaySelectionSourceKey = sourceKey;

    const nextCurveSignatureByModulatorId = new Map(
      chain.devices
        .filter((device) => device.kind === 'modulator')
        .map((device) => [device.id, JSON.stringify(device.params.curve)] as const),
    );
    const changedModulatorIds = new Set<string>();
    for (const [modulatorId, signature] of nextCurveSignatureByModulatorId) {
      if (this.curveSignatureByModulatorId.get(modulatorId) !== signature) {
        changedModulatorIds.add(modulatorId);
      }
    }

    const liveTargetKeys = new Set<string>();
    const liveParameterKeys = new Set<string>();
    for (const [parameterKey, states] of stateByParameter) {
      liveParameterKeys.add(parameterKey);
      let activeTargetKey = getActiveModulationDisplayTargetKey(parameterKey);
      if (!states.some((state) => createModulationDisplayTargetKey(state) === activeTargetKey)) {
        activeTargetKey = undefined;
      }

      for (const state of states) {
        const targetKey = createModulationDisplayTargetKey(state);
        liveTargetKeys.add(targetKey);
        const previousAmount = this.amountByTargetKey.get(targetKey);
        if (
          previousAmount === undefined
          || previousAmount !== state.amount
          || changedModulatorIds.has(state.modulatorId)
        ) {
          activeTargetKey = targetKey;
        }
        this.amountByTargetKey.set(targetKey, state.amount);
      }

      activeTargetKey ??= states.length > 0
        ? createModulationDisplayTargetKey(states[states.length - 1])
        : undefined;
      if (activeTargetKey) {
        const activeState = states.find(
          (state) => createModulationDisplayTargetKey(state) === activeTargetKey,
        );
        if (activeState) {
          activateModulationDisplayTarget(parameterKey, activeState);
        }
      }
    }

    for (const targetKey of this.amountByTargetKey.keys()) {
      if (!liveTargetKeys.has(targetKey)) {
        this.amountByTargetKey.delete(targetKey);
      }
    }
    retainModulationDisplayTargets(liveParameterKeys);
    this.curveSignatureByModulatorId.clear();
    for (const [modulatorId, signature] of nextCurveSignatureByModulatorId) {
      this.curveSignatureByModulatorId.set(modulatorId, signature);
    }
  }

  private resetDisplaySelection(): void {
    this.amountByTargetKey.clear();
    this.curveSignatureByModulatorId.clear();
    this.displaySelectionSourceKey = null;
    resetModulationDisplayTargets();
  }

  private evictStaleSourceFamilyEntries(sourceKey: string): void {
    this.latestSourceKeyByFamily.evictStaleEntries(sourceKey, (staleSourceKey) => {
      this.modulationCacheByKey.delete(staleSourceKey);
    });
  }
}

export const createModulationReadoutCache = (): ModulationReadoutCache =>
  new ModulationReadoutCache();
