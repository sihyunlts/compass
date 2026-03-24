import { clampBounds, isPointInsideClipStack } from '../core/geometry';
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
import type { GroupChain, GroupId } from '../core/pipeline/types';
import {
  applyColorDeviceToNotes,
  composeColorGuideWarp,
  type ClipNoteWithOrigin,
  type ColorGuideWarp,
} from '../devices/color/engine';
import { isGeneratorEngineNode } from '../devices/engine';
import { isDeviceEffectivelyEnabled } from '../shared/group-state';
import { getLaunchpadRuntimeMap } from './launchpad-model';
import { splitChainByGroup, resolveMutedSources } from '../core/pipeline/groups';
import { normalizeOptionalId } from '../shared/normalize-id';
import type { ClipNote, GeneratorChain, GeneratorNode, LaunchpadModel } from '../shared/model';

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

interface RawNotesData {
  notes: ClipNoteWithOrigin[];
}

interface OrderedCheckpointEvaluation {
  notes: ClipNoteWithOrigin[];
  colorGuideWarpByOriginId: ReadonlyMap<string, ColorGuideWarp>;
}

interface OrderedNotesEvaluationContext {
  chain: GeneratorChain;
  groupById: Map<GroupId, GroupChain>;
  generatorById: Map<string, Extract<GeneratorChain['devices'][number], { kind: GeneratorNode['kind'] }>>;
  loopLengthBeats: number;
  launchpadModel?: LaunchpadModel;
  rawNotesByCheckpointKey: Map<string, RawNotesData>;
  orderedNotesByCheckpointKey: Map<string, OrderedCheckpointEvaluation>;
  resolvingCheckpointKeys: Set<string>;
}

const buildGroupById = (
  groupChains: ReadonlyArray<GroupChain>,
): Map<GroupId, GroupChain> => new Map(groupChains.map((group) => [group.id, group]));

const buildGeneratorById = (
  chain: GeneratorChain,
): Map<string, Extract<GeneratorChain['devices'][number], { kind: GeneratorNode['kind'] }>> => {
  const generatorById = new Map<string, Extract<GeneratorChain['devices'][number], { kind: GeneratorNode['kind'] }>>();
  for (const device of chain.devices) {
    if (isGeneratorEngineNode(device)) {
      generatorById.set(device.id, device);
    }
  }
  return generatorById;
};

const buildCheckpointKey = (
  groupId: GroupId,
  endExclusive: number,
): string => `${groupId ?? '__ungrouped__'}:${endExclusive}`;

const cloneOriginNotes = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
): ClipNoteWithOrigin[] => notes.map((note) => ({ ...note }));

const groupNotesByOriginId = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
): Map<string, ClipNoteWithOrigin[]> => {
  const notesByOriginId = new Map<string, ClipNoteWithOrigin[]>();

  for (const note of notes) {
    if (!note.originId) {
      continue;
    }

    const existing = notesByOriginId.get(note.originId);
    if (existing) {
      existing.push({ ...note });
      continue;
    }

    notesByOriginId.set(note.originId, [{ ...note }]);
  }

  return notesByOriginId;
};

const intersectNotesByAddress = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  sourceNotes: ReadonlyArray<ClipNoteWithOrigin>,
  minimumNoteDuration: number,
): ClipNoteWithOrigin[] => {
  if (notes.length === 0 || sourceNotes.length === 0) {
    return [];
  }

  const sourceNotesByAddress = new Map<string, ClipNoteWithOrigin[]>();
  for (const sourceNote of sourceNotes) {
    const key = `${sourceNote.channel}:${sourceNote.pitch}`;
    const existing = sourceNotesByAddress.get(key);
    if (existing) {
      existing.push(sourceNote);
      continue;
    }
    sourceNotesByAddress.set(key, [sourceNote]);
  }

  const intersected: ClipNoteWithOrigin[] = [];
  for (const note of notes) {
    const overlaps = sourceNotesByAddress.get(`${note.channel}:${note.pitch}`);
    if (!overlaps) {
      continue;
    }

    const noteEnd = note.startBeat + note.durationBeats;
    for (const sourceNote of overlaps) {
      const sourceEnd = sourceNote.startBeat + sourceNote.durationBeats;
      const startBeat = Math.max(note.startBeat, sourceNote.startBeat);
      const endBeat = Math.min(noteEnd, sourceEnd);
      if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat) || endBeat <= startBeat) {
        continue;
      }

      intersected.push({
        ...note,
        startBeat,
        durationBeats: Math.max(endBeat - startBeat, minimumNoteDuration),
      });
    }
  }

  sortClipNotes(intersected);
  return intersected;
};

const buildGeometryOnlyCheckpointChain = (
  group: GroupChain,
  endExclusive: number,
  groupStateById: GeneratorChain['groupStateById'],
): GeneratorChain => ({
  devices: group.devices
    .slice(0, endExclusive)
    .filter((device) => device.kind !== 'color')
    .filter((device) => device.kind !== 'mask' || device.params.sourceKind === 'tiles'),
  groupStateById,
});

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
      if (polyline.clipStack.length > 0 && !isPointInsideClipStack(polyline.clipStack, point)) {
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

const collectRawNotesData = ({
  chain,
  loopLengthBeats,
  launchpadModel,
}: GenerateNotesInput): RawNotesData => {
  if (!Number.isFinite(loopLengthBeats) || loopLengthBeats <= 0) {
    return { notes: [] };
  }

  const steps = Math.round(loopLengthBeats * SAMPLES_PER_BEAT);
  if (!Number.isFinite(steps) || steps <= 0) {
    return { notes: [] };
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
  return { notes };
};

const resolveMaskSourceNotes = (
  context: OrderedNotesEvaluationContext,
  consumingGroupId: GroupId,
  consumingDeviceIndex: number,
  maskDevice: Extract<GeneratorChain['devices'][number], { kind: 'mask' }>,
): ClipNoteWithOrigin[] => {
  if (maskDevice.params.sourceKind === 'tiles') {
    return [];
  }

  const sourceId = normalizeOptionalId(maskDevice.params.sourceId);
  if (!sourceId) {
    return [];
  }

  if (maskDevice.params.sourceKind === 'group') {
    const sourceGroup = context.groupById.get(sourceId);
    if (!sourceGroup) {
      return [];
    }

    return evaluateOrderedCheckpointNotes(
      context,
      sourceId,
      sourceId === consumingGroupId ? consumingDeviceIndex : sourceGroup.devices.length,
    ).notes;
  }

  const sourceGenerator = context.generatorById.get(sourceId);
  if (!sourceGenerator) {
    return [];
  }

  const sourceGroupId = normalizeOptionalId(sourceGenerator.groupId);
  const sourceGroup = context.groupById.get(sourceGroupId);
  if (!sourceGroup) {
    return [];
  }

  return evaluateOrderedCheckpointNotes(
    context,
    sourceGroupId,
    sourceGroupId === consumingGroupId ? consumingDeviceIndex : sourceGroup.devices.length,
  ).notes.filter((note) => note.originId === sourceId);
};

const evaluateOrderedCheckpointNotes = (
  context: OrderedNotesEvaluationContext,
  groupId: GroupId,
  endExclusive: number,
): OrderedCheckpointEvaluation => {
  const checkpointKey = buildCheckpointKey(groupId, endExclusive);
  const cached = context.orderedNotesByCheckpointKey.get(checkpointKey);
  if (cached) {
    return cached;
  }

  if (context.resolvingCheckpointKeys.has(checkpointKey)) {
    return {
      notes: [],
      colorGuideWarpByOriginId: new Map(),
    };
  }

  const group = context.groupById.get(groupId);
  if (!group) {
    const empty: OrderedCheckpointEvaluation = {
      notes: [],
      colorGuideWarpByOriginId: new Map<string, ColorGuideWarp>(),
    };
    context.orderedNotesByCheckpointKey.set(checkpointKey, empty);
    return empty;
  }

  context.resolvingCheckpointKeys.add(checkpointKey);

  const rawCached = context.rawNotesByCheckpointKey.get(checkpointKey);
  const rawNotes = rawCached ?? collectRawNotesData({
    chain: buildGeometryOnlyCheckpointChain(group, endExclusive, context.chain.groupStateById),
    loopLengthBeats: context.loopLengthBeats,
    launchpadModel: context.launchpadModel,
  });
  if (!rawCached) {
    context.rawNotesByCheckpointKey.set(checkpointKey, rawNotes);
  }

  const prefixDevices = group.devices.slice(0, endExclusive);
  const prefixChain: GeneratorChain = {
    devices: prefixDevices,
    groupStateById: context.chain.groupStateById,
  };
  const notesByOriginId = groupNotesByOriginId(rawNotes.notes);
  const colorGuideWarpByOriginId = new Map<string, ColorGuideWarp>();
  const upstreamOriginIds: string[] = [];

  for (let index = 0; index < prefixDevices.length; index += 1) {
    const device = prefixDevices[index];
    if (!isDeviceEffectivelyEnabled(prefixChain, device)) {
      continue;
    }

    if (isGeneratorEngineNode(device)) {
      upstreamOriginIds.push(device.id);
      if (!notesByOriginId.has(device.id)) {
        notesByOriginId.set(device.id, []);
      }
      continue;
    }

    if (device.kind === 'color') {
      for (const originId of upstreamOriginIds) {
        const colorProgram = applyColorDeviceToNotes(
          notesByOriginId.get(originId) ?? [],
          device,
          MIN_NOTE_DURATION,
        );
        if (!colorProgram) {
          continue;
        }

        notesByOriginId.set(originId, colorProgram.notes);
        colorGuideWarpByOriginId.set(
          originId,
          composeColorGuideWarp(
            colorGuideWarpByOriginId.get(originId),
            colorProgram.guideWarp,
          ),
        );
      }
      continue;
    }

    if (device.kind === 'mask' && device.params.sourceKind !== 'tiles' && upstreamOriginIds.length > 0) {
      const sourceNotes = resolveMaskSourceNotes(context, groupId, index, device);
      for (const originId of upstreamOriginIds) {
        notesByOriginId.set(
          originId,
          intersectNotesByAddress(
            notesByOriginId.get(originId) ?? [],
            sourceNotes,
            MIN_NOTE_DURATION,
          ),
        );
      }
    }
  }

  const notes: ClipNoteWithOrigin[] = [];
  for (const originId of upstreamOriginIds) {
    notes.push(...cloneOriginNotes(notesByOriginId.get(originId) ?? []));
  }
  sortClipNotes(notes);

  const evaluated: OrderedCheckpointEvaluation = {
    notes,
    colorGuideWarpByOriginId,
  };
  context.orderedNotesByCheckpointKey.set(checkpointKey, evaluated);
  context.resolvingCheckpointKeys.delete(checkpointKey);
  return evaluated;
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

  const groupChains = splitChainByGroup(chain);
  const { mutedGroupIds, mutedGeneratorIds } = resolveMutedSources(chain);
  const context: OrderedNotesEvaluationContext = {
    chain,
    groupById: buildGroupById(groupChains),
    generatorById: buildGeneratorById(chain),
    loopLengthBeats,
    launchpadModel,
    rawNotesByCheckpointKey: new Map(),
    orderedNotesByCheckpointKey: new Map(),
    resolvingCheckpointKeys: new Set(),
  };

  const orderedNotes: ClipNoteWithOrigin[] = [];
  const colorGuideWarpByOriginId = new Map<string, ColorGuideWarp>();

  for (const group of groupChains) {
    if (group.id && mutedGroupIds.has(group.id)) {
      continue;
    }

    const evaluated = evaluateOrderedCheckpointNotes(
      context,
      group.id,
      group.devices.length,
    );

    for (const note of evaluated.notes) {
      if (note.originId && mutedGeneratorIds.has(note.originId)) {
        continue;
      }
      orderedNotes.push({ ...note });
    }

    for (const [originId, warp] of evaluated.colorGuideWarpByOriginId.entries()) {
      if (mutedGeneratorIds.has(originId)) {
        continue;
      }
      colorGuideWarpByOriginId.set(originId, warp);
    }
  }

  sortClipNotes(orderedNotes);
  return {
    notes: orderedNotes,
    colorGuideWarpByOriginId,
  };
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
