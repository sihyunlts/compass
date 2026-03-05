import { clampBounds } from '../core/geometry';
import type { Bounds, Vec2 } from '../core/core-types';
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
import type { OriginWindow } from '../core/pipeline/types';
import {
  applyColorDevices,
  type ClipNoteWithOrigin,
} from '../devices/color/engine';
import { getLaunchpadRuntimeMap } from './launchpad-model';
import type {
  ClipNote,
  GeneratorChain,
  LaunchpadModel,
} from '../shared/types';

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
}

interface OpenNoteState {
  startBeat: number;
  velocity: number;
  channel: number;
  originId?: string;
}

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

const buildOverlayFrameStrokesAtBeat = (
  engine: CompiledPipelineEngine,
  beat01: number,
  originWindows: Map<string, OriginWindow> | undefined,
  stride: number,
  clippedBounds: Bounds | null,
): OverlayFrameStroke[] => {
  const polylines = evaluatePolylinesAtTime(engine, beat01, originWindows);
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

/** Generates clip notes from one chain and one Launchpad model. */
export const generateNotes = ({
  chain,
  loopLengthBeats,
  launchpadModel,
}: GenerateNotesInput): ClipNote[] => {
  if (!Number.isFinite(loopLengthBeats) || loopLengthBeats <= 0) {
    return [];
  }

  const steps = Math.round(loopLengthBeats * SAMPLES_PER_BEAT);
  if (!Number.isFinite(steps) || steps <= 0) {
    return [];
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
    closeOpenNote(notes, pitch, open, 1);
  }

  sortClipNotes(notes);
  const colorizedNotes = applyColorDevices(chain, notes, MIN_NOTE_DURATION);
  sortClipNotes(colorizedNotes);
  return colorizedNotes;
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
}: GenerateOverlayFramesInput): OverlayFrameStroke[][] => {
  if (beats01.length === 0) {
    return [];
  }

  const worldBounds = buildWorldBounds();
  const renderEngine = buildEngine(chain, launchpadModel, worldBounds);
  const originWindows = computeOriginWindowsWithEngine(renderEngine, 1);

  const clippedBounds = bounds ? clampBounds(bounds) : null;
  const step = Number.isFinite(sampleStep) && sampleStep > 0 ? sampleStep : POLYLINE_STEP;
  const stride = Math.max(1, Math.round(step / POLYLINE_STEP));
  const frames: OverlayFrameStroke[][] = [];

  for (const beat01 of beats01) {
    if (!Number.isFinite(beat01) || beat01 < 0 || beat01 > 1) {
      frames.push([]);
      continue;
    }

    frames.push(
      buildOverlayFrameStrokesAtBeat(
        renderEngine,
        beat01,
        originWindows,
        stride,
        clippedBounds,
      ),
    );
  }

  return frames;
};
