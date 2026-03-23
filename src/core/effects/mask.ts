import type { GeneratorLayer, Mask } from '../core-types';
import type { MaskEffectNode, MaskMode } from '../../shared/model';
import { applyMaskToLayer } from '../layer-utils';

const TILE_MIN = 0;
const TILE_MAX = 9;
const TILE_COUNT = 10;

const isInTileBounds = (value: number): boolean =>
  Number.isFinite(value) && value >= TILE_MIN && value <= TILE_MAX;

const toTileIndex = (x: number, y: number): number | null => {
  if (!isInTileBounds(x) || !isInTileBounds(y)) {
    return null;
  }

  const tileX = Math.round(x);
  const tileY = Math.round(y);
  if (!isInTileBounds(tileX) || !isInTileBounds(tileY)) {
    return null;
  }

  return tileY * TILE_COUNT + tileX;
};

const createMaskFromTiles = (
  tiles: Iterable<number>,
  mode: MaskMode,
): Mask => {
  const tileSet = new Set<number>(tiles);

  if (tileSet.size === 0) {
    return mode === 'exclude'
      ? () => true
      : () => false;
  }

  return (x, y) => {
    const tileIndex = toTileIndex(x, y);
    if (tileIndex === null) {
      return mode === 'exclude';
    }
    const isSelected = tileSet.has(tileIndex);
    return mode === 'include' ? isSelected : !isSelected;
  };
};

export const applyMaskEffect = (
  layers: ReadonlyArray<GeneratorLayer>,
  effect: MaskEffectNode,
  tilesOverride?: Iterable<number> | null,
): GeneratorLayer[] => {
  const mask = createMaskFromTiles(tilesOverride ?? effect.params.tiles, effect.params.mode);

  return layers.map((layer) => applyMaskToLayer(layer, mask));
};
