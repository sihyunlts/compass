import type { SceneInstance } from '../core-types';
import type { MaskEffectNode, MaskMode } from '../../shared/model';
import { createTileUnionClip } from '../geometry';
import { appendClipToSceneInstance } from '../layer-utils';

const TILE_COUNT = 10;
const ALL_TILES = Array.from({ length: TILE_COUNT * TILE_COUNT }, (_, tileId) => tileId);

const resolveMaskTiles = (
  tiles: Iterable<number>,
  mode: MaskMode,
): number[] => {
  const tileSet = new Set<number>(tiles);
  if (mode === 'include') {
    return Array.from(tileSet).sort((left, right) => left - right);
  }

  return ALL_TILES.filter((tileId) => !tileSet.has(tileId));
};

export const applyMaskEffect = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  effect: MaskEffectNode,
  tilesOverride?: Iterable<number> | null,
): SceneInstance[] => {
  const clip = createTileUnionClip(resolveMaskTiles(
    tilesOverride ?? effect.params.tiles,
    effect.params.mode,
  ));

  return sceneInstances.map((sceneInstance) => appendClipToSceneInstance(sceneInstance, clip));
};
