import type { Bounds, GeneratorLayer, Mask } from '../core-types';
import type { SymmetryEffectNode } from '../../shared/model';
import {
  COMPOSITION_BOUNDS,
  COMPOSITION_CENTER,
  composeAffine,
  toAxisMirrorTransformAt,
  toRotateTransformAt,
} from '../geometry';
import { applyMaskToLayer, applySpatialTransformToLayer } from '../layer-utils';

interface SymmetryTileRegion {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
}

interface QuadrantDescriptor {
  id: SymmetryEffectNode['params']['sourceAnchor'];
  xMin: boolean;
  yMin: boolean;
}

const SYMMETRY_QUADRANTS: ReadonlyArray<QuadrantDescriptor> = Object.freeze([
  { id: 'bl', xMin: true, yMin: true },
  { id: 'br', xMin: false, yMin: true },
  { id: 'tr', xMin: false, yMin: false },
  { id: 'tl', xMin: true, yMin: false },
]);

const toTileMask = (tile: SymmetryTileRegion, predicate?: (x: number, y: number) => boolean): Mask => (x, y) => {
  const inTile = x >= tile.minX && x < tile.maxX && y >= tile.minY && y < tile.maxY;
  if (!inTile) {
    return false;
  }
  return predicate ? predicate(x, y) : true;
};

const isAnchorMinX = (anchor: SymmetryEffectNode['params']['sourceAnchor']): boolean =>
  anchor === 'bl' || anchor === 'tl';

const isAnchorMinY = (anchor: SymmetryEffectNode['params']['sourceAnchor']): boolean =>
  anchor === 'bl' || anchor === 'br';

const withSymmetryMirrorHalf = (
  layers: ReadonlyArray<GeneratorLayer>,
  effect: SymmetryEffectNode,
  tiles: ReadonlyArray<SymmetryTileRegion>,
  worldBounds: Bounds,
): GeneratorLayer[] => {
  const next: GeneratorLayer[] = [];
  const { axis, sourceAnchor } = effect.params;

  for (const layer of layers) {
    for (const tile of tiles) {
      const sourceOnMin = axis === 'horizontal'
        ? isAnchorMinX(sourceAnchor)
        : isAnchorMinY(sourceAnchor);

      const sourceMask = toTileMask(
        tile,
        axis === 'horizontal'
          ? (x) => (sourceOnMin ? x <= tile.centerX : x > tile.centerX)
          : (_, y) => (sourceOnMin ? y <= tile.centerY : y > tile.centerY),
      );
      next.push(applyMaskToLayer(layer, sourceMask));

      const mirrored = applySpatialTransformToLayer(
        layer,
        toAxisMirrorTransformAt(axis, { x: tile.centerX, y: tile.centerY }),
        worldBounds,
      );
      if (!mirrored) {
        continue;
      }

      const targetMask = toTileMask(
        tile,
        axis === 'horizontal'
          ? (x) => (sourceOnMin ? x > tile.centerX : x <= tile.centerX)
          : (_, y) => (sourceOnMin ? y > tile.centerY : y <= tile.centerY),
      );
      next.push(applyMaskToLayer(mirrored, targetMask));
    }
  }

  return next;
};

const withSymmetryQuadMirror = (
  layers: ReadonlyArray<GeneratorLayer>,
  effect: SymmetryEffectNode,
  tiles: ReadonlyArray<SymmetryTileRegion>,
  worldBounds: Bounds,
): GeneratorLayer[] => {
  const next: GeneratorLayer[] = [];
  const sourceQuadrant = SYMMETRY_QUADRANTS.find((q) => q.id === effect.params.sourceAnchor)!;

  for (const layer of layers) {
    for (const tile of tiles) {
      for (const targetQuadrant of SYMMETRY_QUADRANTS) {
        const quadrantMask = toTileMask(
          tile,
          (x, y) => (
            (targetQuadrant.xMin ? x <= tile.centerX : x > tile.centerX)
            && (targetQuadrant.yMin ? y <= tile.centerY : y > tile.centerY)
          ),
        );

        if (targetQuadrant.id === sourceQuadrant.id) {
          next.push(applyMaskToLayer(layer, quadrantMask));
          continue;
        }

        let transform = null as ReturnType<typeof toRotateTransformAt> | null;
        if (sourceQuadrant.xMin !== targetQuadrant.xMin) {
          transform = toAxisMirrorTransformAt('horizontal', { x: tile.centerX, y: tile.centerY });
        }
        if (sourceQuadrant.yMin !== targetQuadrant.yMin) {
          const vertical = toAxisMirrorTransformAt('vertical', { x: tile.centerX, y: tile.centerY });
          transform = transform ? composeAffine(vertical, transform) : vertical;
        }
        if (!transform) {
          next.push(applyMaskToLayer(layer, quadrantMask));
          continue;
        }

        const mirrored = applySpatialTransformToLayer(layer, transform, worldBounds);
        if (!mirrored) {
          continue;
        }
        next.push(applyMaskToLayer(mirrored, quadrantMask));
      }
    }
  }

  return next;
};

const withSymmetryQuadPinwheel = (
  layers: ReadonlyArray<GeneratorLayer>,
  effect: SymmetryEffectNode,
  tiles: ReadonlyArray<SymmetryTileRegion>,
  worldBounds: Bounds,
): GeneratorLayer[] => {
  const next: GeneratorLayer[] = [];
  const sourceIndex = SYMMETRY_QUADRANTS.findIndex((q) => q.id === effect.params.sourceAnchor);

  for (const layer of layers) {
    for (const tile of tiles) {
      for (let targetIndex = 0; targetIndex < SYMMETRY_QUADRANTS.length; targetIndex += 1) {
        const targetQuadrant = SYMMETRY_QUADRANTS[targetIndex];
        const quadrantMask = toTileMask(
          tile,
          (x, y) => (
            (targetQuadrant.xMin ? x <= tile.centerX : x > tile.centerX)
            && (targetQuadrant.yMin ? y <= tile.centerY : y > tile.centerY)
          ),
        );

        const delta = (targetIndex - sourceIndex + SYMMETRY_QUADRANTS.length) % SYMMETRY_QUADRANTS.length;
        const angleDeg = delta * 90;
        if (angleDeg === 0) {
          next.push(applyMaskToLayer(layer, quadrantMask));
          continue;
        }

        const rotated = applySpatialTransformToLayer(
          layer,
          toRotateTransformAt(angleDeg, { x: tile.centerX, y: tile.centerY }),
          worldBounds,
        );
        if (!rotated) {
          continue;
        }
        next.push(applyMaskToLayer(rotated, quadrantMask));
      }
    }
  }

  return next;
};

export const applySymmetryEffect = (
  layers: ReadonlyArray<GeneratorLayer>,
  effect: SymmetryEffectNode,
  worldBounds: Bounds,
): GeneratorLayer[] => {
  const tiles: SymmetryTileRegion[] = [{
    minX: COMPOSITION_BOUNDS.minX,
    maxX: COMPOSITION_BOUNDS.maxX + 1,
    minY: COMPOSITION_BOUNDS.minY,
    maxY: COMPOSITION_BOUNDS.maxY + 1,
    centerX: COMPOSITION_CENTER.x,
    centerY: COMPOSITION_CENTER.y,
  }];

  if (effect.params.mode === 'mirror-half') {
    return withSymmetryMirrorHalf(layers, effect, tiles, worldBounds);
  }
  if (effect.params.mode === 'quad-mirror') {
    return withSymmetryQuadMirror(layers, effect, tiles, worldBounds);
  }
  return withSymmetryQuadPinwheel(layers, effect, tiles, worldBounds);
};
