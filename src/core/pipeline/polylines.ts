import { buildGeneratorPolyline } from '../../devices/engine';
import type { GeneratorChain, MaskEffectNode } from '../../shared/types';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type { GeneratorLayer, Polyline } from '../core-types';
import { applyTransformToPolyline } from '../geometry';
import { resolveActiveTilesFromPolylines } from './active';
import { POLYLINE_STEP } from './constants';
import {
  pickByTimeKind,
  resolveMaskTime,
} from './groups';
import {
  buildLayers,
  createLayerFromGenerator,
  resolveReverseParityAfter,
} from './layers';
import type {
  GroupEvaluationContext,
  GroupId,
  MaskTimeKind,
  OriginWindow,
} from './types';

const getOriginFitTime = (
  t: number,
  window: OriginWindow | undefined,
): number | null => {
  if (!window) {
    return t;
  }
  if (!Number.isFinite(window.min) || !Number.isFinite(window.max)) {
    return t;
  }

  const span = window.max - window.min;
  if (!Number.isFinite(span) || span <= 0) {
    return t;
  }

  // Warp output time into the active window (trim leading/trailing silence).
  return window.min + t * span;
};

const buildPolylineForLayer = (
  layer: GeneratorLayer,
  t01: number,
): Polyline | null => buildGeneratorPolyline(layer, t01, POLYLINE_STEP);

const buildPolylinesAtTime = (
  layers: ReadonlyArray<GeneratorLayer>,
  t01: number,
  originWindows?: Map<string, OriginWindow>,
): Polyline[] => {
  const polylines: Polyline[] = [];

  for (const layer of layers) {
    const fitTime = getOriginFitTime(t01, originWindows?.get(layer.originId));
    if (fitTime === null) {
      continue;
    }

    const polyline = buildPolylineForLayer(layer, fitTime);
    if (!polyline) {
      continue;
    }

    const transformed = applyTransformToPolyline(polyline, layer.spatial);
    if (layer.mask) {
      transformed.mask = layer.mask;
    }
    polylines.push(transformed);
  }

  return polylines;
};

const resolveActiveTilesForGroup = (
  groupId: GroupId,
  context: GroupEvaluationContext,
  timeKind: MaskTimeKind,
): Set<number> => {
  if (groupId === null) {
    return new Set();
  }

  const cache = pickByTimeKind(
    timeKind,
    context.cache.activeTilesByGroup,
    context.cache.activeTilesByGroupReversed,
  );
  const cached = cache.get(groupId);
  if (cached) {
    return cached;
  }

  const resolving = pickByTimeKind(
    timeKind,
    context.cache.resolvingGroupTiles,
    context.cache.resolvingGroupTilesReversed,
  );
  if (resolving.has(groupId)) {
    return new Set();
  }

  const group = context.groupById.get(groupId);
  if (!group) {
    const empty = new Set<number>();
    cache.set(groupId, empty);
    return empty;
  }

  resolving.add(groupId);
  const polylines = buildSourceGroupPolylinesAtTime(groupId, context, timeKind);
  const active = resolveActiveTilesFromPolylines(polylines);
  resolving.delete(groupId);
  cache.set(groupId, active);
  return active;
};

const resolveActiveTilesForGenerator = (
  generatorId: string,
  context: GroupEvaluationContext,
  timeKind: MaskTimeKind,
): Set<number> => {
  const cache = pickByTimeKind(
    timeKind,
    context.cache.activeTilesByGenerator,
    context.cache.activeTilesByGeneratorReversed,
  );
  const cached = cache.get(generatorId);
  if (cached) {
    return cached;
  }

  const resolving = pickByTimeKind(
    timeKind,
    context.cache.resolvingGeneratorTiles,
    context.cache.resolvingGeneratorTilesReversed,
  );
  if (resolving.has(generatorId)) {
    return new Set();
  }

  resolving.add(generatorId);
  const generator = context.generatorById.get(generatorId);
  if (!generator || !isDeviceEffectivelyEnabled(context.chain, generator)) {
    const empty = new Set<number>();
    cache.set(generatorId, empty);
    resolving.delete(generatorId);
    return empty;
  }

  const layer = createLayerFromGenerator(generator, context.worldBounds);
  const time = resolveMaskTime(context, timeKind);
  const polylines = layer
    ? buildPolylinesAtTime([layer], time, context.originWindows)
    : [];
  const active = resolveActiveTilesFromPolylines(polylines);
  cache.set(generatorId, active);
  resolving.delete(generatorId);
  return active;
};

const resolveMaskTilesForEffect = (
  effect: MaskEffectNode,
  context: GroupEvaluationContext,
  timeKind: MaskTimeKind,
): Iterable<number> => {
  const sourceKind = effect.params.sourceKind ?? 'tiles';
  if (sourceKind === 'group') {
    const sourceId = normalizeOptionalId(effect.params.sourceId);
    if (!sourceId) {
      return [];
    }
    return resolveActiveTilesForGroup(sourceId, context, timeKind);
  }

  if (sourceKind === 'generator') {
    const sourceId = normalizeOptionalId(effect.params.sourceId);
    if (!sourceId) {
      return [];
    }
    return resolveActiveTilesForGenerator(sourceId, context, timeKind);
  }

  return effect.params.tiles ?? [];
};

const buildGroupLayersAtTime = (
  groupId: GroupId,
  context: GroupEvaluationContext,
): GeneratorLayer[] => {
  const cached = context.cache.layersByGroup.get(groupId);
  if (cached) {
    return cached;
  }

  const group = context.groupById.get(groupId);
  if (!group) {
    const empty: GeneratorLayer[] = [];
    context.cache.layersByGroup.set(groupId, empty);
    return empty;
  }

  const groupChain: GeneratorChain = {
    devices: group.devices,
    groupStateById: context.groupStateById,
  };
  const reverseParityAfter = resolveReverseParityAfter(groupChain, group.devices);
  const layers = buildLayers(
    groupChain,
    context.worldBounds,
    (effect, deviceIndex) => {
      if (effect.kind !== 'mask') {
        return null;
      }

      const reverseAfter = reverseParityAfter[deviceIndex] === true;
      const timeKind: MaskTimeKind = reverseAfter ? 'reversed' : 'forward';
      return resolveMaskTilesForEffect(effect, context, timeKind);
    },
  );

  context.cache.layersByGroup.set(groupId, layers);
  return layers;
};

const buildSourceGroupPolylinesAtTime = (
  groupId: GroupId,
  context: GroupEvaluationContext,
  timeKind: MaskTimeKind,
): Polyline[] => {
  const cache = pickByTimeKind(
    timeKind,
    context.cache.sourcePolylinesByGroup,
    context.cache.sourcePolylinesByGroupReversed,
  );
  const cached = cache.get(groupId);
  if (cached) {
    return cached;
  }

  const layers = buildGroupLayersAtTime(groupId, context);
  const time = resolveMaskTime(context, timeKind);
  const polylines = buildPolylinesAtTime(layers, time, context.originWindows);
  cache.set(groupId, polylines);
  return polylines;
};

const buildOutputGroupPolylinesAtTime = (
  groupId: GroupId,
  context: GroupEvaluationContext,
): Polyline[] => {
  const cached = context.cache.outputPolylinesByGroup.get(groupId);
  if (cached) {
    return cached;
  }

  if (groupId && context.mutedGroupIds.has(groupId)) {
    const empty: Polyline[] = [];
    context.cache.outputPolylinesByGroup.set(groupId, empty);
    return empty;
  }

  const layers = buildGroupLayersAtTime(groupId, context);
  const filteredLayers = context.mutedGeneratorIds.size > 0
    ? layers.filter((layer) => !context.mutedGeneratorIds.has(layer.originId))
    : layers;

  const polylines = filteredLayers.length > 0
    ? buildPolylinesAtTime(filteredLayers, context.time, context.originWindows)
    : [];
  context.cache.outputPolylinesByGroup.set(groupId, polylines);
  return polylines;
};

export const buildPolylinesForAllGroups = (
  context: GroupEvaluationContext,
): Polyline[] => {
  const polylines: Polyline[] = [];

  for (const group of context.groupChains) {
    polylines.push(...buildOutputGroupPolylinesAtTime(group.id, context));
  }

  return polylines;
};
