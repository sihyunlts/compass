import { SvelteMap } from 'svelte/reactivity';

import {
  generateOverlayFrames,
  type OverlayFrameStroke,
} from '../../../domain';
import type { GeneratorChain, LaunchpadModel } from '../../../shared/model';
import {
  PREVIEW_FRAME_COUNT,
  toPreviewFrameBeat,
} from '../../services/preview-cache';
import {
  resolveOverlayWorldBounds,
  type OverlayWorldBounds,
} from './view-model';

const OVERLAY_SAMPLE_STEP = 0.25;
const OVERLAY_WORLD_BASE_PADDING = 4;
const OVERLAY_WORLD_PADDING_STEP = 2;
const OVERLAY_WORLD_MAX_PADDING = 14;
const PREVIEW_FRAME_BEATS = Array.from(
  { length: PREVIEW_FRAME_COUNT },
  (_, index) => toPreviewFrameBeat(index),
);

export interface OverlayCacheEntry {
  key: string;
  bounds: OverlayWorldBounds;
  framesByIndex: ReadonlyArray<ReadonlyArray<OverlayFrameStroke>>;
}

const touchesOverlayBoundary = (
  strokes: ReadonlyArray<OverlayFrameStroke>,
  bounds: OverlayWorldBounds,
): boolean => {
  if (strokes.length === 0) {
    return false;
  }

  const edgeMargin = OVERLAY_SAMPLE_STEP * 1.1;
  const minXEdge = bounds.minX + edgeMargin;
  const maxXEdge = bounds.maxX - edgeMargin;
  const minYEdge = bounds.minY + edgeMargin;
  const maxYEdge = bounds.maxY - edgeMargin;

  for (const stroke of strokes) {
    for (const point of stroke.points) {
      if (
        point.x <= minXEdge
        || point.x >= maxXEdge
        || point.y <= minYEdge
        || point.y >= maxYEdge
      ) {
        return true;
      }
    }
  }

  return false;
};

const touchesOverlayFrameCacheBoundary = (
  framesByIndex: ReadonlyArray<ReadonlyArray<OverlayFrameStroke>>,
  bounds: OverlayWorldBounds,
): boolean => {
  for (const frameStrokes of framesByIndex) {
    if (touchesOverlayBoundary(frameStrokes, bounds)) {
      return true;
    }
  }
  return false;
};

class OverlayFrameCache {
  private readonly overlayFramesByKey = new SvelteMap<string, OverlayCacheEntry>();

  public resolve(
    sourceKey: string,
    chain: GeneratorChain,
    launchpadModel: LaunchpadModel,
  ): OverlayCacheEntry {
    const key = `${sourceKey}:${launchpadModel}`;
    const cached = this.overlayFramesByKey.get(key);
    if (cached) {
      return cached;
    }

    let nextPadding = OVERLAY_WORLD_BASE_PADDING;
    let nextBounds = resolveOverlayWorldBounds(nextPadding);
    let nextFramesByIndex = this.buildOverlayFrames(chain, nextBounds, launchpadModel);

    while (
      touchesOverlayFrameCacheBoundary(nextFramesByIndex, nextBounds)
      && nextPadding < OVERLAY_WORLD_MAX_PADDING
    ) {
      nextPadding = Math.min(
        OVERLAY_WORLD_MAX_PADDING,
        nextPadding + OVERLAY_WORLD_PADDING_STEP,
      );
      nextBounds = resolveOverlayWorldBounds(nextPadding);
      nextFramesByIndex = this.buildOverlayFrames(chain, nextBounds, launchpadModel);
    }

    const entry: OverlayCacheEntry = {
      key,
      bounds: nextBounds,
      framesByIndex: nextFramesByIndex,
    };
    this.overlayFramesByKey.set(key, entry);
    return entry;
  }

  private buildOverlayFrames(
    chain: GeneratorChain,
    bounds: OverlayWorldBounds,
    launchpadModel: LaunchpadModel,
  ): ReadonlyArray<ReadonlyArray<OverlayFrameStroke>> {
    return generateOverlayFrames({
      chain,
      beats01: PREVIEW_FRAME_BEATS,
      sampleStep: OVERLAY_SAMPLE_STEP,
      bounds,
      launchpadModel,
    });
  }
}

export const createOverlayFrameCache = (): OverlayFrameCache =>
  new OverlayFrameCache();
