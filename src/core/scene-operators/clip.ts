import type { ClipShape, SceneInstance } from '../core-types';
import { IDENTITY_AFFINE, createTileUnionClip } from '../geometry';

export const appendClipToSceneInstance = (
  sceneInstance: SceneInstance,
  shape: ClipShape,
): SceneInstance => ({
  ...sceneInstance,
  clipStack: [
    ...sceneInstance.clipStack,
    {
      shape,
      inverseTransform: IDENTITY_AFFINE,
    },
  ],
});

export const appendClipToSceneInstances = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  shape: ClipShape,
): SceneInstance[] => sceneInstances.map((sceneInstance) => appendClipToSceneInstance(sceneInstance, shape));

export const appendTileUnionClipToSceneInstances = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  tiles: Iterable<number>,
): SceneInstance[] => appendClipToSceneInstances(sceneInstances, createTileUnionClip(tiles));
