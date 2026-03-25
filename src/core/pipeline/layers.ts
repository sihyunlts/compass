import {
  applyPipelineEffect,
  createSceneInstanceFromGenerator,
  doesDeviceToggleTimelineParity,
  type EffectApplicationContext,
  type PipelineEffectNode,
} from '../../devices/engine';
import type { GeneratorChain, GeneratorDeviceNode, GeneratorNode } from '../../shared/model';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type { Bounds, SceneInstance, TemporalVisibilityWindow } from '../core-types';
import type { ButtonIndex } from './types';
import { isEffectNode, isGeneratorNode } from './groups';
import { sampleNaturalActiveWindow } from './temporal-source-window';

type EffectContextResolver = (
  effect: PipelineEffectNode,
  deviceIndex: number,
) => Omit<EffectApplicationContext, 'worldBounds' | 'buttonIndex' | 'sourceTemporalWindowByOriginId'> | null;

const buildNaturalTemporalWindowCacheKey = (
  effectId: string,
  originId: string,
): string => `${effectId}:${originId}`;

const buildSourceTemporalWindowByOriginId = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  effect: Extract<PipelineEffectNode, { kind: 'stretch' | 'trim' | 'timewarp' }>,
  buttonIndex: ButtonIndex,
  effectContext: Omit<EffectApplicationContext, 'worldBounds' | 'buttonIndex' | 'sourceTemporalWindowByOriginId'> | null,
): Map<string, TemporalVisibilityWindow> => {
  const sourceWindowByOriginId = new Map<string, TemporalVisibilityWindow>();
  const naturalWindowCache = effectContext?.naturalTemporalWindowByEffectOriginKey;
  const originIds = new Set(
    sceneInstances
      .filter((sceneInstance) => !sceneInstance.temporal.hasAuthoredTimeline)
      .map((sceneInstance) => sceneInstance.originId),
  );

  for (const originId of originIds) {
    const cacheKey = buildNaturalTemporalWindowCacheKey(effect.id, originId);
    const cached = naturalWindowCache?.get(cacheKey);
    if (cached) {
      sourceWindowByOriginId.set(originId, cached);
      continue;
    }
    if (cached === null) {
      continue;
    }

    const sampled = sampleNaturalActiveWindow(
      sceneInstances.filter((sceneInstance) => sceneInstance.originId === originId),
      buttonIndex,
    );
    naturalWindowCache?.set(cacheKey, sampled);
    if (sampled) {
      sourceWindowByOriginId.set(originId, sampled);
    }
  }

  return sourceWindowByOriginId;
};

export const createSceneInstanceFromNode = (
  device: GeneratorNode,
  worldBounds: Bounds,
): SceneInstance | null => createSceneInstanceFromGenerator(device, worldBounds);

export const buildSceneInstances = (
  chain: GeneratorChain,
  worldBounds: Bounds,
  buttonIndex: ButtonIndex,
  resolveEffectContext?: EffectContextResolver,
): SceneInstance[] => {
  let sceneInstances: SceneInstance[] = [];

  for (let index = 0; index < chain.devices.length; index += 1) {
    const device = chain.devices[index];
    if (!isDeviceEffectivelyEnabled(chain, device)) {
      continue;
    }

    if (isGeneratorNode(device)) {
      const sceneInstance = createSceneInstanceFromNode(device, worldBounds);
      if (sceneInstance) {
        sceneInstances.push(sceneInstance);
      }
      continue;
    }

    if (!isEffectNode(device)) {
      continue;
    }

    const effectContext = resolveEffectContext?.(device, index);
    const targetGroupId = normalizeOptionalId(device.groupId);
    if (!targetGroupId) {
      const sourceTemporalWindowByOriginId = (
        device.kind === 'stretch'
        || device.kind === 'trim'
        || device.kind === 'timewarp'
      )
        ? buildSourceTemporalWindowByOriginId(sceneInstances, device, buttonIndex, effectContext)
        : undefined;
      sceneInstances = applyPipelineEffect(sceneInstances, device, {
        worldBounds,
        buttonIndex,
        tilesOverride: effectContext?.tilesOverride ?? null,
        sourceTemporalWindowByOriginId,
        naturalTemporalWindowByEffectOriginKey: effectContext?.naturalTemporalWindowByEffectOriginKey,
      });
      continue;
    }

    const scopedInstances = sceneInstances.filter((sceneInstance) =>
      sceneInstance.originGroupId === targetGroupId);
    const unscopedInstances = sceneInstances.filter((sceneInstance) =>
      sceneInstance.originGroupId !== targetGroupId);
    const sourceTemporalWindowByOriginId = (
      device.kind === 'stretch'
      || device.kind === 'trim'
      || device.kind === 'timewarp'
    )
      ? buildSourceTemporalWindowByOriginId(scopedInstances, device, buttonIndex, effectContext)
      : undefined;
    const transformedInstances = applyPipelineEffect(scopedInstances, device, {
      worldBounds,
      buttonIndex,
      tilesOverride: effectContext?.tilesOverride ?? null,
      sourceTemporalWindowByOriginId,
      naturalTemporalWindowByEffectOriginKey: effectContext?.naturalTemporalWindowByEffectOriginKey,
    });
    sceneInstances = [...unscopedInstances, ...transformedInstances];
  }

  return sceneInstances;
};

export const resolveReverseParityAfter = (
  chain: GeneratorChain,
  devices: ReadonlyArray<GeneratorDeviceNode>,
): boolean[] => {
  const parityAfter: boolean[] = new Array(devices.length).fill(false);
  let parity = false;

  for (let index = devices.length - 1; index >= 0; index -= 1) {
    parityAfter[index] = parity;
    const device = devices[index];
    if (doesDeviceToggleTimelineParity(device) && isDeviceEffectivelyEnabled(chain, device)) {
      parity = !parity;
    }
  }

  return parityAfter;
};
