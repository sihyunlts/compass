import { clampBounds } from '../core/geometry';
import type { Bounds, Polyline, Vec2 } from '../core/core-types';
import {
  MIN_NOTE_DURATION,
  POLYLINE_STEP,
  SAMPLES_PER_BEAT,
  buildWorldBounds,
} from '../core/pipeline/constants';
import {
  compilePipelineEngine,
  computeOriginWindowsWithEngine,
  evaluateActiveByPitchAtTime,
  evaluatePolylinesAtTime,
  type CompiledPipelineEngine,
} from '../core/pipeline/engine';
import {
  applyColorProgramsDetailed,
  type ClipNoteWithOrigin,
  type ColorGuideWarp,
} from '../devices/color/engine';
import { getLaunchpadRuntimeMap } from './launchpad-model';
import type { ClipNote, GeneratorChain, LaunchpadModel } from '../shared/model';

/** Statistics summary for generated notes. */
export interface PreviewStats {
  noteCount: number;
  uniquePitchCount: number;
}

/** One polyline stroke frame rendered by the preview overlay. */
export interface OverlayFrameStroke {
  points: Vec2[];
  closed: boolean;
}

export interface GenerateNotesInput {
  chain: GeneratorChain;
  loopLengthBeats: number;
  launchpadModel?: LaunchpadModel;
}

export interface GenerateOverlayFramesInput {
  chain: GeneratorChain;
  beats01: ReadonlyArray<number>;
  launchpadModel?: LaunchpadModel;
  sampleStep?: number;
  bounds?: Bounds;
  loopLengthBeats?: number;
  colorGuideWarpByOriginId?: ReadonlyMap<string, ColorGuideWarp>;
}

export interface PreviewNotesData {
  notes: ClipNote[];
  colorGuideWarpByOriginId: ReadonlyMap<string, ColorGuideWarp>;
}

interface OpenNoteState {
  startBeat: number;
  velocity: number;
  channel: number;
  originId?: string;
}

export const NORMALIZED_SOURCE_TIMELINE_END_BEAT = 1;

const sortClipNotes = <T extends ClipNote>(notes: T[]): void => {
  notes.sort((left, right) =>
    left.startBeat - right.startBeat
    || left.pitch - right.pitch
    || left.channel - right.channel);
};

const closeOpenNote = (
  notes: ClipNoteWithOrigin[],
  pitch: number,
  open: OpenNoteState,
  endBeat: number,
): void => {
  const orderedStart = Math.max(Math.min(open.startBeat, endBeat), 0);
  const orderedEnd = Math.max(Math.max(open.startBeat, endBeat), 0);
  notes.push({
    pitch,
    channel: open.channel,
    startBeat: orderedStart,
    durationBeats: Math.max(orderedEnd - orderedStart, MIN_NOTE_DURATION),
    velocity: open.velocity,
    originId: open.originId,
  });
};

const toClipNote = (note: ClipNoteWithOrigin): ClipNote => ({
  pitch: note.pitch,
  channel: note.channel,
  startBeat: note.startBeat,
  durationBeats: note.durationBeats,
  velocity: note.velocity,
});

const buildEngine = (
  chain: GeneratorChain,
  launchpadModel: LaunchpadModel | undefined,
  worldBounds?: Bounds,
): CompiledPipelineEngine => {
  const runtimeMap = getLaunchpadRuntimeMap(launchpadModel);
  return compilePipelineEngine(chain, {
    buttons: runtimeMap.buttons,
    buttonIndex: runtimeMap.buttonIndex,
    worldBounds,
  });
};

const buildOverlayFrameStrokes = (
  polylines: ReadonlyArray<Polyline>,
  stride: number,
  clippedBounds: Bounds | null,
): OverlayFrameStroke[] => {
  const strokes: OverlayFrameStroke[] = [];

  for (const polyline of polylines) {
    if (polyline.points.length < 2) {
      continue;
    }

    let segment: Vec2[] = [];
    let broke = false;
    for (let index = 0; index < polyline.points.length; index += stride) {
      const point = polyline.points[index];
      if (polyline.mask && !polyline.mask(point.x, point.y)) {
        if (segment.length > 1) {
          strokes.push({ points: segment, closed: false });
        }
        segment = [];
        broke = true;
        continue;
      }

      if (clippedBounds) {
        if (
          point.x < clippedBounds.minX
          || point.x > clippedBounds.maxX
          || point.y < clippedBounds.minY
          || point.y > clippedBounds.maxY
        ) {
          if (segment.length > 1) {
            strokes.push({ points: segment, closed: false });
          }
          segment = [];
          broke = true;
          continue;
        }
      }

      segment.push({
        x: Number(point.x.toFixed(3)),
        y: Number(point.y.toFixed(3)),
      });
    }

    if (segment.length > 1) {
      strokes.push({
        points: segment,
        closed: polyline.closed && !broke,
      });
    }
  }

  return strokes;
};

const buildGeneratedNotesData = ({
  chain,
  loopLengthBeats,
  launchpadModel,
}: GenerateNotesInput): {
  notes: ClipNoteWithOrigin[];
  colorGuideWarpByOriginId: ReadonlyMap<string, ColorGuideWarp>;
} => {
  if (!Number.isFinite(loopLengthBeats) || loopLengthBeats <= 0) {
    return {
      notes: [],
      colorGuideWarpByOriginId: new Map(),
    };
  }

  const steps = Math.round(loopLengthBeats * SAMPLES_PER_BEAT);
  if (!Number.isFinite(steps) || steps <= 0) {
    return {
      notes: [],
      colorGuideWarpByOriginId: new Map(),
    };
  }

  const engine = buildEngine(chain, launchpadModel);
  const originWindows = computeOriginWindowsWithEngine(engine, loopLengthBeats);

  const openByPitch = new Map<number, OpenNoteState>();
  const notes: ClipNoteWithOrigin[] = [];

  for (let step = 0; step < steps; step += 1) {
    const t01 = step / steps;
    const activeByPitch = evaluateActiveByPitchAtTime(engine, t01, originWindows);

    for (const [pitch, open] of openByPitch.entries()) {
      if (activeByPitch.has(pitch)) {
        continue;
      }
      closeOpenNote(notes, pitch, open, t01);
      openByPitch.delete(pitch);
    }

    for (const [pitch, active] of activeByPitch.entries()) {
      const existing = openByPitch.get(pitch);
      if (!existing) {
        openByPitch.set(pitch, {
          startBeat: t01,
          velocity: active.velocity,
          channel: active.channel,
          originId: active.originId,
        });
        continue;
      }

      if (
        existing.velocity === active.velocity
        && existing.channel === active.channel
        && existing.originId === active.originId
      ) {
        continue;
      }

      closeOpenNote(notes, pitch, existing, t01);
      openByPitch.set(pitch, {
        startBeat: t01,
        velocity: active.velocity,
        channel: active.channel,
        originId: active.originId,
      });
    }
  }

  for (const [pitch, open] of openByPitch.entries()) {
    closeOpenNote(notes, pitch, open, NORMALIZED_SOURCE_TIMELINE_END_BEAT);
  }

  sortClipNotes(notes);
  const colorized = applyColorProgramsDetailed(chain, notes, MIN_NOTE_DURATION);
  sortClipNotes(colorized.notes);
  return colorized;
};

const resolveGuideBeat = (
  beat01: number,
  warp: ColorGuideWarp | undefined,
): number => {
  if (!warp || !Number.isFinite(warp.scale) || warp.scale >= 1) {
    return beat01;
  }

  const sourceSpan = warp.sourceEndBeat - warp.sourceStartBeat;
  if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
    return beat01;
  }

  const relativeBeat = Math.max(0, beat01 - warp.sourceStartBeat);
  const advancedBeat = warp.sourceStartBeat + Math.min(relativeBeat / warp.scale, sourceSpan);
  return Math.min(Math.max(advancedBeat, 0), NORMALIZED_SOURCE_TIMELINE_END_BEAT);
};

/** Generates clip notes from one chain and one Launchpad model. */
export const generatePreviewNotesData = ({
  chain,
  loopLengthBeats,
  launchpadModel,
}: GenerateNotesInput): PreviewNotesData => {
  const generated = buildGeneratedNotesData({
    chain,
    loopLengthBeats,
    launchpadModel,
  });

  return {
    notes: generated.notes.map((note) => toClipNote(note)),
    colorGuideWarpByOriginId: generated.colorGuideWarpByOriginId,
  };
};

/** Generates clip notes from one chain and one Launchpad model. */
export const generateNotes = ({
  chain,
  loopLengthBeats,
  launchpadModel,
}: GenerateNotesInput): ClipNote[] => {
  return generatePreviewNotesData({
    chain,
    loopLengthBeats,
    launchpadModel,
  }).notes;
};

/** Counts total notes and unique pitches (deduped by pitch value). */
export const generatePreviewStats = (notes: ReadonlyArray<ClipNote>): PreviewStats => {
  const uniquePitches = new Set<number>();
  for (const note of notes) {
    uniquePitches.add(note.pitch);
  }

  return {
    noteCount: notes.length,
    uniquePitchCount: uniquePitches.size,
  };
};

/** Generates vector overlay frames used by the preview surface. */
export const generateOverlayFrames = ({
  chain,
  beats01,
  launchpadModel,
  sampleStep = POLYLINE_STEP,
  bounds,
  loopLengthBeats = 1,
  colorGuideWarpByOriginId,
}: GenerateOverlayFramesInput): OverlayFrameStroke[][] => {
  if (beats01.length === 0) {
    return [];
  }

  const worldBounds = buildWorldBounds();
  const renderEngine = buildEngine(chain, launchpadModel, worldBounds);
  const originWindows = computeOriginWindowsWithEngine(renderEngine, 1);
  const guideWarpByOriginId = colorGuideWarpByOriginId
    ?? buildGeneratedNotesData({
      chain,
      loopLengthBeats,
      launchpadModel,
    }).colorGuideWarpByOriginId;

  const clippedBounds = bounds ? clampBounds(bounds) : null;
  const step = Number.isFinite(sampleStep) && sampleStep > 0 ? sampleStep : POLYLINE_STEP;
  const stride = Math.max(1, Math.round(step / POLYLINE_STEP));
  const frames: OverlayFrameStroke[][] = [];

  for (const beat01 of beats01) {
    if (!Number.isFinite(beat01) || beat01 < 0 || beat01 > 1) {
      frames.push([]);
      continue;
    }

    const visiblePolylines = evaluatePolylinesAtTime(
      renderEngine,
      beat01,
      originWindows,
    );
    const originIdsByGuideBeat = new Map<number, Set<string>>();
    for (const polyline of visiblePolylines) {
      const guideBeat = resolveGuideBeat(
        beat01,
        guideWarpByOriginId.get(polyline.originId),
      );
      const originIds = originIdsByGuideBeat.get(guideBeat);
      if (originIds) {
        originIds.add(polyline.originId);
        continue;
      }

      originIdsByGuideBeat.set(guideBeat, new Set([polyline.originId]));
    }

    if (originIdsByGuideBeat.size === 1 && originIdsByGuideBeat.has(beat01)) {
      frames.push(buildOverlayFrameStrokes(visiblePolylines, stride, clippedBounds));
      continue;
    }

    const frameStrokes: OverlayFrameStroke[] = [];
    for (const [guideBeat, originIds] of originIdsByGuideBeat.entries()) {
      const guidePolylines = guideBeat === beat01
        ? visiblePolylines
        : evaluatePolylinesAtTime(
        renderEngine,
        guideBeat,
        originWindows,
      );
      frameStrokes.push(...buildOverlayFrameStrokes(
        guidePolylines.filter((polyline) => originIds.has(polyline.originId)),
        stride,
        clippedBounds,
      ));
    }

    frames.push(frameStrokes);
  }

  return frames;
};
