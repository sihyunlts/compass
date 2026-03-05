import type { Polyline } from '../core-types';
import { distanceToPolylineSquared } from '../geometry';
import {
  THICKNESS,
  TILE_COUNT,
  TILE_MAX,
  TILE_MIN,
} from './constants';
import type { ActivePitchInfo, ButtonIndex } from './types';

export const resolveActiveTilesFromPolylines = (
  polylines: ReadonlyArray<Polyline>,
): Set<number> => {
  const active = new Set<number>();
  const thicknessSq = THICKNESS * THICKNESS;

  for (let y = TILE_MIN; y <= TILE_MAX; y += 1) {
    for (let x = TILE_MIN; x <= TILE_MAX; x += 1) {
      let isActive = false;
      for (const polyline of polylines) {
        if (polyline.mask && !polyline.mask(x, y)) {
          continue;
        }
        const distanceSq = distanceToPolylineSquared({ x, y }, polyline);
        if (distanceSq <= thicknessSq) {
          isActive = true;
          break;
        }
      }

      if (isActive) {
        active.add(y * TILE_COUNT + x);
      }
    }
  }

  return active;
};

export const resolveActiveByPitch = (
  polylines: ReadonlyArray<Polyline>,
  buttonIndex: ButtonIndex,
): Map<number, ActivePitchInfo> => {
  const active = new Map<number, ActivePitchInfo>();
  const thicknessSq = THICKNESS * THICKNESS;

  for (const group of buttonIndex.groups) {
    if (group.buttons.length === 0) {
      continue;
    }
    const { x, y } = group;

    let maxVelocity = 0;
    let maxVelocityOriginId: string | null = null;
    for (const polyline of polylines) {
      if (polyline.mask && !polyline.mask(x, y)) {
        continue;
      }
      const distanceSq = distanceToPolylineSquared({ x, y }, polyline);
      if (distanceSq <= thicknessSq) {
        if (polyline.velocity > maxVelocity) {
          maxVelocity = polyline.velocity;
          maxVelocityOriginId = polyline.originId;
        }
      }
    }

    if (maxVelocity <= 0) {
      continue;
    }

    for (const button of group.buttons) {
      const prev = active.get(button.output.number);
      if (!prev || maxVelocity > prev.velocity) {
        active.set(button.output.number, {
          velocity: maxVelocity,
          channel: button.output.channel,
          originId: maxVelocityOriginId ?? undefined,
        });
      }
    }
  }

  return active;
};
