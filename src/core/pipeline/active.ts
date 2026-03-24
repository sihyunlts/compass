import type { Bounds, Polyline, SceneInstance, Vec2 } from '../core-types';
import { buildGeneratorPolyline } from '../../devices/engine';
import {
  applyTransformToPolyline,
  distanceToPolylineSquared,
  isPointInsideClipStack,
} from '../geometry';
import {
  POLYLINE_STEP,
  THICKNESS,
  TILE_COUNT,
  TILE_MAX,
  TILE_MIN,
} from './constants';
import type { ActivePitchInfo, ButtonIndex } from './types';

export interface ActivationFrame {
  time: number;
  activeTiles: Set<number>;
  activeByPitch: Map<number, ActivePitchInfo>;
}

export interface OverlayFrameStroke {
  points: Vec2[];
  closed: boolean;
}

export interface ExactOutputFrame {
  time: number;
  activationFrame: ActivationFrame;
  overlayStrokes: ReadonlyArray<OverlayFrameStroke>;
}

const buildOverlayCellStroke = (x: number, y: number): OverlayFrameStroke => ({
  points: [
    { x: x - 0.5, y: y - 0.5 },
    { x: x + 0.5, y: y - 0.5 },
    { x: x + 0.5, y: y + 0.5 },
    { x: x - 0.5, y: y + 0.5 },
  ],
  closed: true,
});

const doesOverlayCellIntersectBounds = (
  x: number,
  y: number,
  bounds: Bounds,
): boolean => (
  x + 0.5 >= bounds.minX
  && x - 0.5 <= bounds.maxX
  && y + 0.5 >= bounds.minY
  && y - 0.5 <= bounds.maxY
);

export const projectSceneToPolylinesAtTime = (
  scene: ReadonlyArray<SceneInstance>,
  time: number,
): Polyline[] => {
  const polylines: Polyline[] = [];

  for (const sceneInstance of scene) {
    const polyline = buildGeneratorPolyline(sceneInstance, time, POLYLINE_STEP);
    if (!polyline) {
      continue;
    }

    polylines.push(applyTransformToPolyline({
      ...polyline,
      clipStack: sceneInstance.clipStack,
    }, sceneInstance.spatial));
  }

  return polylines;
};

export const resolveActiveTilesFromPolylines = (
  polylines: ReadonlyArray<Polyline>,
): Set<number> => {
  const active = new Set<number>();
  const thicknessSq = THICKNESS * THICKNESS;

  for (let y = TILE_MIN; y <= TILE_MAX; y += 1) {
    for (let x = TILE_MIN; x <= TILE_MAX; x += 1) {
      let isActive = false;
      for (const polyline of polylines) {
        if (polyline.clipStack.length > 0 && !isPointInsideClipStack(polyline.clipStack, { x, y })) {
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
      if (polyline.clipStack.length > 0 && !isPointInsideClipStack(polyline.clipStack, { x, y })) {
        continue;
      }
      const distanceSq = distanceToPolylineSquared({ x, y }, polyline);
      if (distanceSq <= thicknessSq && polyline.velocity > maxVelocity) {
        maxVelocity = polyline.velocity;
        maxVelocityOriginId = polyline.originId;
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

export const projectSceneToActivationFrame = (
  scene: ReadonlyArray<SceneInstance>,
  time: number,
  launchpadMap: ButtonIndex,
): ActivationFrame => {
  const polylines = projectSceneToPolylinesAtTime(scene, time);

  return {
    time,
    activeTiles: resolveActiveTilesFromPolylines(polylines),
    activeByPitch: resolveActiveByPitch(polylines, launchpadMap),
  };
};

export const projectActivationFrameToOverlayStrokes = (
  activationFrame: ActivationFrame,
  launchpadMap: ButtonIndex,
  bounds?: Bounds,
): OverlayFrameStroke[] => {
  const strokes: OverlayFrameStroke[] = [];

  for (const group of launchpadMap.groups) {
    const isActive = group.buttons.some((button) =>
      activationFrame.activeByPitch.has(button.output.number));
    if (!isActive) {
      continue;
    }
    if (bounds && !doesOverlayCellIntersectBounds(group.x, group.y, bounds)) {
      continue;
    }
    strokes.push(buildOverlayCellStroke(group.x, group.y));
  }

  return strokes;
};

export const projectSceneToExactOutputFrame = (
  scene: ReadonlyArray<SceneInstance>,
  time: number,
  launchpadMap: ButtonIndex,
  bounds?: Bounds,
): ExactOutputFrame => {
  const activationFrame = projectSceneToActivationFrame(scene, time, launchpadMap);

  return {
    time,
    activationFrame,
    overlayStrokes: projectActivationFrameToOverlayStrokes(
      activationFrame,
      launchpadMap,
      bounds,
    ),
  };
};
