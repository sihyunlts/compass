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
import { getLaunchpadRuntimeMap } from './launchpad-model';
import { isDeviceEffectivelyEnabled } from '../shared/group-state';
import { normalizeOptionalId } from '../shared/normalize-id';
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

interface ClipNoteWithOrigin extends ClipNote {
  originId?: string;
}

interface ColorOriginConfig {
  velocities: number[];
  noteLengthPercent: number;
}

const DEFAULT_COLOR_VELOCITY = 3;
const DEFAULT_COLOR_NOTE_LENGTH_PERCENT = 100;
const sortNumbersAscending = (left: number, right: number): number => left - right;

const sortClipNotes = <T extends ClipNote>(notes: T[]): void => {
  notes.sort((left, right) =>
    left.startBeat - right.startBeat
    || left.pitch - right.pitch
    || left.channel - right.channel);
};

const toClipNote = (note: ClipNoteWithOrigin): ClipNote => ({
  pitch: note.pitch,
  channel: note.channel,
  startBeat: note.startBeat,
  durationBeats: note.durationBeats,
  velocity: note.velocity,
});

const sanitizeColorVelocities = (velocities: readonly number[]): number[] => {
  const sanitized = velocities
    .map((slotVelocity) => Number(slotVelocity))
    .filter((slotVelocity) => Number.isFinite(slotVelocity))
    .map((slotVelocity) => Math.round(slotVelocity))
    .filter((slotVelocity) => slotVelocity >= 1 && slotVelocity <= 127);
  return sanitized.length > 0 ? sanitized : [DEFAULT_COLOR_VELOCITY];
};

const sanitizeColorNoteLengthPercent = (value: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? numeric
    : DEFAULT_COLOR_NOTE_LENGTH_PERCENT;
};

const isGeneratorDevice = (
  device: GeneratorChain['devices'][number],
): boolean => (
  device.kind === 'waterdrop'
  || device.kind === 'scanner'
  || device.kind === 'spiral'
);

const resolveColorConfigByOriginId = (
  chain: GeneratorChain,
): Map<string, ColorOriginConfig> => {
  const devicesByGroupId = new Map<string | null, Array<GeneratorChain['devices'][number]>>();
  for (const device of chain.devices) {
    const groupId = normalizeOptionalId(device.groupId);
    const groupDevices = devicesByGroupId.get(groupId);
    if (groupDevices) {
      groupDevices.push(device);
      continue;
    }
    devicesByGroupId.set(groupId, [device]);
  }

  const configByOriginId = new Map<string, ColorOriginConfig>();
  for (const groupDevices of devicesByGroupId.values()) {
    let accumulatedVelocities: number[] = [];
    let accumulatedNoteLengthPercent: number | null = null;

    for (let index = groupDevices.length - 1; index >= 0; index -= 1) {
      const device = groupDevices[index];
      if (!isDeviceEffectivelyEnabled(chain, device)) {
        continue;
      }

      if (device.kind === 'color') {
        const velocities = sanitizeColorVelocities(device.params.velocities ?? []);
        accumulatedVelocities = [...velocities, ...accumulatedVelocities];
        accumulatedNoteLengthPercent = sanitizeColorNoteLengthPercent(
          device.params.noteLengthPercent,
        );
        continue;
      }

      if (!isGeneratorDevice(device) || accumulatedVelocities.length === 0) {
        continue;
      }

      configByOriginId.set(device.id, {
        velocities: [...accumulatedVelocities],
        noteLengthPercent: accumulatedNoteLengthPercent ?? DEFAULT_COLOR_NOTE_LENGTH_PERCENT,
      });
    }
  }

  return configByOriginId;
};

const resolveMedianDuration = (
  durations: ReadonlyArray<number>,
): number | null => {
  if (durations.length === 0) {
    return null;
  }

  const orderedDurations = [...durations].sort(sortNumbersAscending);
  const middleIndex = Math.floor(orderedDurations.length / 2);

  if (orderedDurations.length % 2 === 1) {
    return orderedDurations[middleIndex];
  }

  return (orderedDurations[middleIndex - 1] + orderedDurations[middleIndex]) / 2;
};

const resolveMedianDurationByOriginId = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
): Map<string, number> => {
  const durationsByOriginId = new Map<string, number[]>();

  for (const note of notes) {
    if (!note.originId || !Number.isFinite(note.durationBeats) || note.durationBeats <= 0) {
      continue;
    }

    const originDurations = durationsByOriginId.get(note.originId);
    if (originDurations) {
      originDurations.push(note.durationBeats);
      continue;
    }

    durationsByOriginId.set(note.originId, [note.durationBeats]);
  }

  const medianDurationByOriginId = new Map<string, number>();
  for (const [originId, durations] of durationsByOriginId.entries()) {
    const medianDuration = resolveMedianDuration(durations);
    if (medianDuration === null) {
      continue;
    }
    medianDurationByOriginId.set(originId, medianDuration);
  }

  return medianDurationByOriginId;
};

const applyColorDevices = (
  chain: GeneratorChain,
  notes: ReadonlyArray<ClipNoteWithOrigin>,
): ClipNote[] => {
  if (notes.length === 0) {
    return [];
  }

  const colorConfigByOriginId = resolveColorConfigByOriginId(chain);
  if (colorConfigByOriginId.size === 0) {
    return notes.map((note) => toClipNote(note));
  }

  const medianDurationByOriginId = resolveMedianDurationByOriginId(notes);
  if (medianDurationByOriginId.size === 0) {
    return notes.map((note) => toClipNote(note));
  }

  const colorized: ClipNote[] = [];

  for (const note of notes) {
    if (!note.originId) {
      colorized.push(toClipNote(note));
      continue;
    }

    const colorConfig = colorConfigByOriginId.get(note.originId);
    if (!colorConfig) {
      colorized.push(toClipNote(note));
      continue;
    }

    const referenceDuration = medianDurationByOriginId.get(note.originId);
    if (referenceDuration === undefined) {
      colorized.push(toClipNote(note));
      continue;
    }

    const segmentLength = Math.max(
      referenceDuration * (colorConfig.noteLengthPercent / 100),
      MIN_NOTE_DURATION,
    );
    if (!Number.isFinite(note.startBeat) || !Number.isFinite(segmentLength) || segmentLength <= 0) {
      colorized.push(toClipNote(note));
      continue;
    }

    const velocities = colorConfig.velocities;
    if (velocities.length === 0) {
      colorized.push(toClipNote(note));
      continue;
    }

    for (let segmentIndex = 0; segmentIndex < velocities.length; segmentIndex += 1) {
      const segmentStart = note.startBeat + segmentIndex * segmentLength;
      if (!Number.isFinite(segmentStart)) {
        break;
      }

      colorized.push({
        pitch: note.pitch,
        channel: note.channel,
        startBeat: segmentStart,
        durationBeats: segmentLength,
        velocity: velocities[segmentIndex],
      });
    }
  }

  return colorized;
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
  const colorizedNotes = applyColorDevices(chain, notes);
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
