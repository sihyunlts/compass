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
import type { Bounds, SceneInstance } from '../core-types';
import { isEffectNode, isGeneratorNode } from './groups';

type EffectContextResolver = (
  effect: PipelineEffectNode,
  deviceIndex: number,
) => Omit<EffectApplicationContext, 'worldBounds'> | null;

export const createSceneInstanceFromNode = (
  device: GeneratorNode,
  worldBounds: Bounds,
): SceneInstance | null => createSceneInstanceFromGenerator(device, worldBounds);

export const buildSceneInstances = (
  chain: GeneratorChain,
  worldBounds: Bounds,
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
      sceneInstances = applyPipelineEffect(sceneInstances, device, {
        worldBounds,
        tilesOverride: effectContext?.tilesOverride ?? null,
      });
      continue;
    }

    const scopedInstances = sceneInstances.filter((sceneInstance) =>
      sceneInstance.originGroupId === targetGroupId);
    const unscopedInstances = sceneInstances.filter((sceneInstance) =>
      sceneInstance.originGroupId !== targetGroupId);
    const transformedInstances = applyPipelineEffect(scopedInstances, device, {
      worldBounds,
      tilesOverride: effectContext?.tilesOverride ?? null,
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
