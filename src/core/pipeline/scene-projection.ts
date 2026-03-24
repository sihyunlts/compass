import { buildGeneratorPolyline } from '../../devices/engine';
import type { Polyline, SceneInstance } from '../core-types';
import { applyTransformToPolyline } from '../geometry';
import { POLYLINE_STEP } from './constants';

const projectSceneInstancePolyline = (
  sceneInstance: SceneInstance,
  time: number,
): Polyline | null => {
  const polyline = buildGeneratorPolyline(sceneInstance, time, POLYLINE_STEP);
  if (!polyline) {
    return null;
  }

  return applyTransformToPolyline({
    ...polyline,
    clipStack: sceneInstance.clipStack,
  }, sceneInstance.spatial);
};

export const projectSceneToPolylinesAtTime = (
  scene: ReadonlyArray<SceneInstance>,
  time: number,
): Polyline[] => {
  const polylines: Polyline[] = [];

  for (const sceneInstance of scene) {
    const polyline = projectSceneInstancePolyline(sceneInstance, time);
    if (polyline) {
      polylines.push(polyline);
    }
  }

  return polylines;
};
