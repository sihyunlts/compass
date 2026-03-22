import { SvelteMap } from 'svelte/reactivity';

import {
  generateOverlayFrames,
  type ColorGuideWarp,
  type OverlayFrameStroke,
} from '../../../domain';
import type { GeneratorChain, LaunchpadModel } from '../../../shared/model';
import {
  PREVIEW_FRAME_COUNT,
  toPreviewFrameBeat,
} from './frame-index';
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

interface OverlayCacheEntry {
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

  private lastRendererSourceRevisionKey: string | null = null;

  public resolve(
    sourceKey: string,
    chain: GeneratorChain,
    launchpadModel: LaunchpadModel,
    loopLengthBeats: number,
    colorGuideWarpByOriginId?: ReadonlyMap<string, ColorGuideWarp>,
  ): OverlayCacheEntry {
    this.evictStaleRendererRevision(sourceKey);
    const key = `${sourceKey}:${launchpadModel}:${loopLengthBeats}`;
    const cached = this.overlayFramesByKey.get(key);
    if (cached) {
      return cached;
    }

    let nextPadding = OVERLAY_WORLD_BASE_PADDING;
    let nextBounds = resolveOverlayWorldBounds(nextPadding);
    let nextFramesByIndex = this.buildOverlayFrames(
      chain,
      nextBounds,
      launchpadModel,
      loopLengthBeats,
      colorGuideWarpByOriginId,
    );

    while (
      touchesOverlayFrameCacheBoundary(nextFramesByIndex, nextBounds)
      && nextPadding < OVERLAY_WORLD_MAX_PADDING
    ) {
      nextPadding = Math.min(
        OVERLAY_WORLD_MAX_PADDING,
        nextPadding + OVERLAY_WORLD_PADDING_STEP,
      );
      nextBounds = resolveOverlayWorldBounds(nextPadding);
      nextFramesByIndex = this.buildOverlayFrames(
        chain,
        nextBounds,
        launchpadModel,
        loopLengthBeats,
        colorGuideWarpByOriginId,
      );
    }

    const entry: OverlayCacheEntry = {
      key,
      bounds: nextBounds,
      framesByIndex: nextFramesByIndex,
    };
    this.overlayFramesByKey.set(key, entry);
    return entry;
  }

  public reset(): void {
    this.overlayFramesByKey.clear();
    this.lastRendererSourceRevisionKey = null;
  }

  private buildOverlayFrames(
    chain: GeneratorChain,
    bounds: OverlayWorldBounds,
    launchpadModel: LaunchpadModel,
    loopLengthBeats: number,
    colorGuideWarpByOriginId?: ReadonlyMap<string, ColorGuideWarp>,
  ): ReadonlyArray<ReadonlyArray<OverlayFrameStroke>> {
    return generateOverlayFrames({
      chain,
      beats01: PREVIEW_FRAME_BEATS,
      sampleStep: OVERLAY_SAMPLE_STEP,
      bounds,
      launchpadModel,
      loopLengthBeats,
      colorGuideWarpByOriginId,
    });
  }

  private evictStaleRendererRevision(sourceKey: string): void {
    if (!sourceKey.startsWith('chain:')) {
      return;
    }

    if (this.lastRendererSourceRevisionKey === sourceKey) {
      return;
    }

    const stalePrefix = this.lastRendererSourceRevisionKey
      ? `${this.lastRendererSourceRevisionKey}:`
      : null;
    if (stalePrefix) {
      for (const key of this.overlayFramesByKey.keys()) {
        if (key.startsWith(stalePrefix)) {
          this.overlayFramesByKey.delete(key);
        }
      }
    }

    this.lastRendererSourceRevisionKey = sourceKey;
  }
}

export const createOverlayFrameCache = (): OverlayFrameCache =>
  new OverlayFrameCache();
