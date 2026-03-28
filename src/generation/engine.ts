import { composeAffine, COMPOSITION_CENTER, applyAffine, toAxisMirrorTransformAt, toMirrorTransformAt, toRotateTransformAt, toScaleTransformAt, toTranslationTransform } from '../core/geometry';
import { resolveMutedSources } from '../core/pipeline/groups';
import { stripModulationDevicesFromChain } from '../core/modulation/routing';
import { evaluateTemporalRemap } from '../core/scene-operators/temporal';
import { createSampledRemapFromTimeWarpCurve, isIdentityTimeWarpCurve } from '../core/timewarp/curve';
import {
  buildColorConfig,
  planColorProgramSlots,
  type ClipNoteWithOrigin,
} from '../devices/color/color-program';
import { doesDeviceToggleTimelineParity } from '../devices/engine';
import { isDeviceEffectivelyEnabled } from '../shared/group-state';
import type {
  ColorEffectNode,
  GeneratorChain,
  GeneratorEffectNode,
  GeneratorNode,
  MaskEffectNode,
  StretchEffectNode,
  SymmetryEffectNode,
  TimeWarpEffectNode,
  TrimEffectNode,
} from '../shared/model';
import { normalizeOptionalId } from '../shared/normalize-id';
import type { RuntimeMapData } from '../domain/note-generation-types';
import { buildLedFramesBySampleIndex, buildButtonCoordinateByAddress, buildCoordinateGroupByKey, projectTapeToNotes, rasterizeGeneratorFrame, resolveProjectedActiveTiles, toRoundedTileId } from './raster';
import { addCellToFrame, cloneTape, createEmptyTape, ensureTapeFrameCount, finalizeTape } from './tape';
import type { GeneratedFieldResult, LedCell, LedTape } from './types';

interface TimelineWindow {
  start: number;
  end: number;
}

interface OriginTimelineState {
  authored: boolean;
  window: TimelineWindow;
}

interface MutableGenerationState {
  tape: LedTape;
  timelineStateByOriginId: Map<string, OriginTimelineState>;
}

interface OriginTemporalMapping {
  outputWindow: TimelineWindow;
  mapOutputBeatToSourceBeat: (beat: number) => number | null;
  nextTimelineState: OriginTimelineState;
}

const DEFAULT_TIMELINE_WINDOW: TimelineWindow = Object.freeze({
  start: 0,
  end: 1,
});

const cloneTimelineStateByOriginId = (
  timelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
): Map<string, OriginTimelineState> => new Map(
  Array.from(timelineStateByOriginId.entries(), ([originId, timelineState]) => [
    originId,
    {
      authored: timelineState.authored,
      window: {
        start: timelineState.window.start,
        end: timelineState.window.end,
      },
    },
  ]),
);

const isTargetedCell = (
  cell: LedCell,
  targetGroupId: string | null,
): boolean => targetGroupId === null || cell.originGroupId === targetGroupId;

const splitFrameCellsByTarget = (
  cells: ReadonlyArray<LedCell>,
  targetGroupId: string | null,
): {
  targeted: LedCell[];
  untargeted: LedCell[];
} => {
  const targeted: LedCell[] = [];
  const untargeted: LedCell[] = [];

  for (const cell of cells) {
    if (isTargetedCell(cell, targetGroupId)) {
      targeted.push(cell);
    } else {
      untargeted.push({ ...cell });
    }
  }

  return {
    targeted,
    untargeted,
  };
};

const buildTargetOriginIds = (
  tape: LedTape,
  targetGroupId: string | null,
): Set<string> => {
  const originIds = new Set<string>();

  for (const frame of tape.frames) {
    for (const cell of frame.cells) {
      if (isTargetedCell(cell, targetGroupId)) {
        originIds.add(cell.originId);
      }
    }
  }

  return originIds;
};

const buildOccupiedWindowByOriginId = (
  tape: LedTape,
): Map<string, TimelineWindow> => {
  const windowByOriginId = new Map<string, TimelineWindow>();

  for (let frameIndex = 0; frameIndex < tape.frames.length; frameIndex += 1) {
    const frameStart = frameIndex * tape.sampleStepBeats;
    const frameEnd = (frameIndex + 1) * tape.sampleStepBeats;

    for (const cell of tape.frames[frameIndex].cells) {
      const existing = windowByOriginId.get(cell.originId);
      if (existing) {
        if (frameStart < existing.start) {
          existing.start = frameStart;
        }
        if (frameEnd > existing.end) {
          existing.end = frameEnd;
        }
      } else {
        windowByOriginId.set(cell.originId, {
          start: frameStart,
          end: frameEnd,
        });
      }
    }
  }

  return windowByOriginId;
};

const resolveSourceWindow = (
  originId: string,
  timelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
  occupiedWindowByOriginId: ReadonlyMap<string, TimelineWindow>,
): TimelineWindow => {
  const timelineState = timelineStateByOriginId.get(originId);
  if (timelineState?.authored === true) {
    return timelineState.window;
  }

  return occupiedWindowByOriginId.get(originId) ?? timelineState?.window ?? DEFAULT_TIMELINE_WINDOW;
};

const resolvePassthroughEndBeat = (
  tape: LedTape,
  targetGroupId: string | null,
): number => {
  let maxEndBeat = 0;

  for (let frameIndex = 0; frameIndex < tape.frames.length; frameIndex += 1) {
    const frameEndBeat = (frameIndex + 1) * tape.sampleStepBeats;
    for (const cell of tape.frames[frameIndex].cells) {
      if (isTargetedCell(cell, targetGroupId)) {
        continue;
      }

      if (frameEndBeat > maxEndBeat) {
        maxEndBeat = frameEndBeat;
      }
    }
  }

  return maxEndBeat;
};

const applySpatialTransform = (
  state: MutableGenerationState,
  targetGroupId: string | null,
  writeOrder: number,
  transform: ReturnType<typeof toTranslationTransform> | null,
): MutableGenerationState => {
  if (!transform) {
    return {
      tape: cloneTape(state.tape),
      timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
    };
  }

  const nextTape = createEmptyTape(state.tape.sampleStepBeats, state.tape.timeDomainEndBeat);
  nextTape.nextWriteId = state.tape.nextWriteId;
  ensureTapeFrameCount(nextTape, state.tape.timeDomainEndBeat);

  for (let frameIndex = 0; frameIndex < state.tape.frames.length; frameIndex += 1) {
    const { targeted, untargeted } = splitFrameCellsByTarget(
      state.tape.frames[frameIndex].cells,
      targetGroupId,
    );
    nextTape.frames[frameIndex].cells.push(...untargeted);

    for (const cell of targeted) {
      const point = applyAffine(transform, { x: cell.x, y: cell.y });
      addCellToFrame(nextTape, frameIndex, {
        x: point.x,
        y: point.y,
        velocity: cell.velocity,
        originId: cell.originId,
        originGroupId: cell.originGroupId,
        writeOrder,
      });
    }
  }

  nextTape.timeDomainEndBeat = state.tape.timeDomainEndBeat;
  return {
    tape: finalizeTape(nextTape),
    timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
  };
};

const isWithinHalfBoundary = (
  coordinate: number,
  boundary: number,
  keepMin: boolean,
): boolean => keepMin ? coordinate <= boundary : coordinate >= boundary;

const isInQuadrant = (
  x: number,
  y: number,
  anchor: SymmetryEffectNode['params']['sourceAnchor'],
): boolean => {
  const keepMinX = anchor === 'bl' || anchor === 'tl';
  const keepMinY = anchor === 'bl' || anchor === 'br';
  return isWithinHalfBoundary(x, COMPOSITION_CENTER.x, keepMinX)
    && isWithinHalfBoundary(y, COMPOSITION_CENTER.y, keepMinY);
};

const applyMirrorHalfSymmetry = (
  state: MutableGenerationState,
  effect: SymmetryEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
): MutableGenerationState => {
  const nextTape = createEmptyTape(state.tape.sampleStepBeats, state.tape.timeDomainEndBeat);
  nextTape.nextWriteId = state.tape.nextWriteId;
  ensureTapeFrameCount(nextTape, state.tape.timeDomainEndBeat);

  const keepMin = effect.params.axis === 'horizontal'
    ? effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'tl'
    : effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'br';
  const mirrorTransform = toAxisMirrorTransformAt(effect.params.axis, COMPOSITION_CENTER);

  for (let frameIndex = 0; frameIndex < state.tape.frames.length; frameIndex += 1) {
    const { targeted, untargeted } = splitFrameCellsByTarget(
      state.tape.frames[frameIndex].cells,
      targetGroupId,
    );
    nextTape.frames[frameIndex].cells.push(...untargeted);

    for (const cell of targeted) {
      const sourceCoordinate = effect.params.axis === 'horizontal' ? cell.x : cell.y;
      const boundary = effect.params.axis === 'horizontal' ? COMPOSITION_CENTER.x : COMPOSITION_CENTER.y;
      if (isWithinHalfBoundary(sourceCoordinate, boundary, keepMin)) {
        addCellToFrame(nextTape, frameIndex, {
          x: cell.x,
          y: cell.y,
          velocity: cell.velocity,
          originId: cell.originId,
          originGroupId: cell.originGroupId,
          writeOrder,
        });
      }

      const mirrored = applyAffine(mirrorTransform, { x: cell.x, y: cell.y });
      const mirroredCoordinate = effect.params.axis === 'horizontal' ? mirrored.x : mirrored.y;
      if (!isWithinHalfBoundary(mirroredCoordinate, boundary, !keepMin)) {
        continue;
      }

      addCellToFrame(nextTape, frameIndex, {
        x: mirrored.x,
        y: mirrored.y,
        velocity: cell.velocity,
        originId: cell.originId,
        originGroupId: cell.originGroupId,
        writeOrder,
      });
    }
  }

  return {
    tape: finalizeTape(nextTape),
    timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
  };
};

const applyQuadMirrorSymmetry = (
  state: MutableGenerationState,
  effect: SymmetryEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
): MutableGenerationState => {
  const nextTape = createEmptyTape(state.tape.sampleStepBeats, state.tape.timeDomainEndBeat);
  nextTape.nextWriteId = state.tape.nextWriteId;
  ensureTapeFrameCount(nextTape, state.tape.timeDomainEndBeat);

  const quadrants: ReadonlyArray<SymmetryEffectNode['params']['sourceAnchor']> = ['bl', 'br', 'tr', 'tl'];
  const sourceKeepMinX = effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'tl';
  const sourceKeepMinY = effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'br';

  for (let frameIndex = 0; frameIndex < state.tape.frames.length; frameIndex += 1) {
    const { targeted, untargeted } = splitFrameCellsByTarget(
      state.tape.frames[frameIndex].cells,
      targetGroupId,
    );
    nextTape.frames[frameIndex].cells.push(...untargeted);

    for (const cell of targeted) {
      for (const quadrant of quadrants) {
        const targetKeepMinX = quadrant === 'bl' || quadrant === 'tl';
        const targetKeepMinY = quadrant === 'bl' || quadrant === 'br';

        let transform = null as ReturnType<typeof toTranslationTransform> | null;
        if (sourceKeepMinX !== targetKeepMinX) {
          transform = toAxisMirrorTransformAt('horizontal', COMPOSITION_CENTER);
        }
        if (sourceKeepMinY !== targetKeepMinY) {
          const verticalTransform = toAxisMirrorTransformAt('vertical', COMPOSITION_CENTER);
          transform = transform
            ? composeAffine(verticalTransform, transform)
            : verticalTransform;
        }

        const transformed = transform
          ? applyAffine(transform, { x: cell.x, y: cell.y })
          : { x: cell.x, y: cell.y };
        if (!isInQuadrant(transformed.x, transformed.y, quadrant)) {
          continue;
        }

        addCellToFrame(nextTape, frameIndex, {
          x: transformed.x,
          y: transformed.y,
          velocity: cell.velocity,
          originId: cell.originId,
          originGroupId: cell.originGroupId,
          writeOrder,
        });
      }
    }
  }

  return {
    tape: finalizeTape(nextTape),
    timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
  };
};

const applyQuadPinwheelSymmetry = (
  state: MutableGenerationState,
  effect: SymmetryEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
): MutableGenerationState => {
  const nextTape = createEmptyTape(state.tape.sampleStepBeats, state.tape.timeDomainEndBeat);
  nextTape.nextWriteId = state.tape.nextWriteId;
  ensureTapeFrameCount(nextTape, state.tape.timeDomainEndBeat);

  const quadrants: ReadonlyArray<SymmetryEffectNode['params']['sourceAnchor']> = ['bl', 'br', 'tr', 'tl'];
  const sourceIndex = quadrants.findIndex((quadrant) => quadrant === effect.params.sourceAnchor);

  for (let frameIndex = 0; frameIndex < state.tape.frames.length; frameIndex += 1) {
    const { targeted, untargeted } = splitFrameCellsByTarget(
      state.tape.frames[frameIndex].cells,
      targetGroupId,
    );
    nextTape.frames[frameIndex].cells.push(...untargeted);

    for (const cell of targeted) {
      for (let targetIndex = 0; targetIndex < quadrants.length; targetIndex += 1) {
        const quadrant = quadrants[targetIndex];
        const delta = (targetIndex - sourceIndex + quadrants.length) % quadrants.length;
        const angleDeg = delta * 90;
        const transformed = angleDeg === 0
          ? { x: cell.x, y: cell.y }
          : applyAffine(
              toRotateTransformAt(angleDeg, COMPOSITION_CENTER),
              { x: cell.x, y: cell.y },
            );
        if (!isInQuadrant(transformed.x, transformed.y, quadrant)) {
          continue;
        }

        addCellToFrame(nextTape, frameIndex, {
          x: transformed.x,
          y: transformed.y,
          velocity: cell.velocity,
          originId: cell.originId,
          originGroupId: cell.originGroupId,
          writeOrder,
        });
      }
    }
  }

  return {
    tape: finalizeTape(nextTape),
    timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
  };
};

const applySymmetryEffect = (
  state: MutableGenerationState,
  effect: SymmetryEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
): MutableGenerationState => {
  if (effect.params.mode === 'mirror-half') {
    return applyMirrorHalfSymmetry(state, effect, targetGroupId, writeOrder);
  }

  if (effect.params.mode === 'quad-mirror') {
    return applyQuadMirrorSymmetry(state, effect, targetGroupId, writeOrder);
  }

  return applyQuadPinwheelSymmetry(state, effect, targetGroupId, writeOrder);
};

const buildSourceCellsByOriginAndFrame = (
  tape: LedTape,
  targetGroupId: string | null,
): Map<string, Map<number, LedCell[]>> => {
  const cellsByOriginId = new Map<string, Map<number, LedCell[]>>();

  for (let frameIndex = 0; frameIndex < tape.frames.length; frameIndex += 1) {
    for (const cell of tape.frames[frameIndex].cells) {
      if (!isTargetedCell(cell, targetGroupId)) {
        continue;
      }

      let frameMap = cellsByOriginId.get(cell.originId);
      if (!frameMap) {
        frameMap = new Map<number, LedCell[]>();
        cellsByOriginId.set(cell.originId, frameMap);
      }

      let frameCells = frameMap.get(frameIndex);
      if (!frameCells) {
        frameCells = [];
        frameMap.set(frameIndex, frameCells);
      }

      frameCells.push(cell);
    }
  }

  return cellsByOriginId;
};

const buildTemporalMappingsOutputEndBeat = (
  passthroughEndBeat: number,
  mappings: ReadonlyMap<string, OriginTemporalMapping>,
): number => {
  let maxEndBeat = passthroughEndBeat;

  for (const mapping of mappings.values()) {
    if (mapping.outputWindow.end > maxEndBeat) {
      maxEndBeat = mapping.outputWindow.end;
    }
  }

  return Math.max(maxEndBeat, 1);
};

const applyTemporalRemap = (
  state: MutableGenerationState,
  targetGroupId: string | null,
  mappings: ReadonlyMap<string, OriginTemporalMapping>,
  writeOrder: number,
): MutableGenerationState => {
  const passthroughEndBeat = resolvePassthroughEndBeat(state.tape, targetGroupId);
  const outputEndBeat = buildTemporalMappingsOutputEndBeat(passthroughEndBeat, mappings);
  const nextTape = createEmptyTape(state.tape.sampleStepBeats, outputEndBeat);
  nextTape.nextWriteId = state.tape.nextWriteId;
  ensureTapeFrameCount(nextTape, outputEndBeat);

  for (let frameIndex = 0; frameIndex < state.tape.frames.length; frameIndex += 1) {
    for (const cell of state.tape.frames[frameIndex].cells) {
      if (isTargetedCell(cell, targetGroupId)) {
        continue;
      }

      if (frameIndex < nextTape.frames.length) {
        nextTape.frames[frameIndex].cells.push({ ...cell });
      }
    }
  }

  const sourceCellsByOriginAndFrame = buildSourceCellsByOriginAndFrame(state.tape, targetGroupId);
  for (const [originId, mapping] of mappings.entries()) {
    const outputSpan = mapping.outputWindow.end - mapping.outputWindow.start;
    if (!Number.isFinite(outputSpan) || outputSpan <= 0) {
      continue;
    }

    const sourceCellsByFrame = sourceCellsByOriginAndFrame.get(originId);
    if (!sourceCellsByFrame) {
      continue;
    }

    const startFrame = Math.max(Math.floor(mapping.outputWindow.start / nextTape.sampleStepBeats), 0);
    const endFrameExclusive = Math.min(
      Math.ceil(mapping.outputWindow.end / nextTape.sampleStepBeats),
      nextTape.frames.length,
    );

    for (let frameIndex = startFrame; frameIndex < endFrameExclusive; frameIndex += 1) {
      const outputBeat = frameIndex * nextTape.sampleStepBeats;
      const sourceBeat = mapping.mapOutputBeatToSourceBeat(outputBeat);
      if (sourceBeat === null || !Number.isFinite(sourceBeat)) {
        continue;
      }

      const sourceFrameIndex = Math.min(
        Math.max(Math.floor(sourceBeat / state.tape.sampleStepBeats), 0),
        Math.max(state.tape.frames.length - 1, 0),
      );
      const sourceCells = sourceCellsByFrame.get(sourceFrameIndex);
      if (!sourceCells || sourceCells.length === 0) {
        continue;
      }

      for (const cell of sourceCells) {
        addCellToFrame(nextTape, frameIndex, {
          x: cell.x,
          y: cell.y,
          velocity: cell.velocity,
          originId: cell.originId,
          originGroupId: cell.originGroupId,
          writeOrder,
        });
      }
    }
  }

  const nextTimelineStateByOriginId = cloneTimelineStateByOriginId(state.timelineStateByOriginId);
  for (const [originId, mapping] of mappings.entries()) {
    nextTimelineStateByOriginId.set(originId, {
      authored: mapping.nextTimelineState.authored,
      window: {
        start: mapping.nextTimelineState.window.start,
        end: mapping.nextTimelineState.window.end,
      },
    });
  }

  return {
    tape: finalizeTape(nextTape),
    timelineStateByOriginId: nextTimelineStateByOriginId,
  };
};

const buildReverseMappings = (
  state: MutableGenerationState,
  targetGroupId: string | null,
): Map<string, OriginTemporalMapping> => {
  const mappings = new Map<string, OriginTemporalMapping>();
  const occupiedWindowByOriginId = buildOccupiedWindowByOriginId(state.tape);

  for (const originId of buildTargetOriginIds(state.tape, targetGroupId)) {
    const timelineState = state.timelineStateByOriginId.get(originId);
    const sourceWindow = resolveSourceWindow(
      originId,
      state.timelineStateByOriginId,
      occupiedWindowByOriginId,
    );
    const sourceSpan = sourceWindow.end - sourceWindow.start;
    if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
      continue;
    }

    const outputWindow = timelineState?.authored === true
      ? timelineState.window
      : {
          start: 0,
          end: sourceSpan,
        };
    const outputSpan = outputWindow.end - outputWindow.start;
    if (!Number.isFinite(outputSpan) || outputSpan <= 0) {
      continue;
    }

    mappings.set(originId, {
      outputWindow,
      mapOutputBeatToSourceBeat: (outputBeat) => {
        if (outputBeat < outputWindow.start || outputBeat >= outputWindow.end) {
          return null;
        }

        const normalizedEnd = Math.min(
          Math.max(((outputBeat + state.tape.sampleStepBeats) - outputWindow.start) / outputSpan, 0),
          1,
        );
        return sourceWindow.start + sourceSpan * (1 - normalizedEnd);
      },
      nextTimelineState: {
        authored: timelineState?.authored === true,
        window: outputWindow,
      },
    });
  }

  return mappings;
};

const buildTrimMappings = (
  state: MutableGenerationState,
  effect: TrimEffectNode,
  targetGroupId: string | null,
): Map<string, OriginTemporalMapping> => {
  const mappings = new Map<string, OriginTemporalMapping>();
  const start = effect.params.start;
  const end = effect.params.end;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1 || end <= start) {
    return mappings;
  }

  const occupiedWindowByOriginId = buildOccupiedWindowByOriginId(state.tape);
  for (const originId of buildTargetOriginIds(state.tape, targetGroupId)) {
    const timelineState = state.timelineStateByOriginId.get(originId);
    const sourceWindow = resolveSourceWindow(
      originId,
      state.timelineStateByOriginId,
      occupiedWindowByOriginId,
    );
    const sourceSpan = sourceWindow.end - sourceWindow.start;
    if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
      continue;
    }

    const outputWindow = timelineState?.authored === true
      ? timelineState.window
      : DEFAULT_TIMELINE_WINDOW;
    const outputSpan = outputWindow.end - outputWindow.start;
    if (!Number.isFinite(outputSpan) || outputSpan <= 0) {
      continue;
    }

    mappings.set(originId, {
      outputWindow,
      mapOutputBeatToSourceBeat: (outputBeat) => {
        if (outputBeat < outputWindow.start || outputBeat >= outputWindow.end) {
          return null;
        }

        const normalized = (outputBeat - outputWindow.start) / outputSpan;
        return sourceWindow.start + sourceSpan * (start + normalized * (end - start));
      },
      nextTimelineState: {
        authored: true,
        window: outputWindow,
      },
    });
  }

  return mappings;
};

const buildStretchMappings = (
  state: MutableGenerationState,
  effect: StretchEffectNode,
  targetGroupId: string | null,
): Map<string, OriginTemporalMapping> => {
  const mappings = new Map<string, OriginTemporalMapping>();
  const start = effect.params.start;
  const end = effect.params.end;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1 || end <= start) {
    return mappings;
  }

  const outputWindow: TimelineWindow = { start, end };
  const outputSpan = outputWindow.end - outputWindow.start;
  if (!Number.isFinite(outputSpan) || outputSpan <= 0) {
    return mappings;
  }

  const occupiedWindowByOriginId = buildOccupiedWindowByOriginId(state.tape);
  for (const originId of buildTargetOriginIds(state.tape, targetGroupId)) {
    const sourceWindow = resolveSourceWindow(
      originId,
      state.timelineStateByOriginId,
      occupiedWindowByOriginId,
    );
    const sourceSpan = sourceWindow.end - sourceWindow.start;
    if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
      continue;
    }

    mappings.set(originId, {
      outputWindow,
      mapOutputBeatToSourceBeat: (outputBeat) => {
        if (outputBeat < outputWindow.start || outputBeat >= outputWindow.end) {
          return null;
        }

        const normalized = (outputBeat - outputWindow.start) / outputSpan;
        return sourceWindow.start + sourceSpan * normalized;
      },
      nextTimelineState: {
        authored: true,
        window: outputWindow,
      },
    });
  }

  return mappings;
};

const buildTimeWarpMappings = (
  state: MutableGenerationState,
  effect: TimeWarpEffectNode,
  targetGroupId: string | null,
): Map<string, OriginTemporalMapping> => {
  const mappings = new Map<string, OriginTemporalMapping>();
  if (isIdentityTimeWarpCurve(effect.params.curve)) {
    return mappings;
  }

  const remap = createSampledRemapFromTimeWarpCurve(effect.params.curve);
  const occupiedWindowByOriginId = buildOccupiedWindowByOriginId(state.tape);

  for (const originId of buildTargetOriginIds(state.tape, targetGroupId)) {
    const timelineState = state.timelineStateByOriginId.get(originId);
    const sourceWindow = resolveSourceWindow(
      originId,
      state.timelineStateByOriginId,
      occupiedWindowByOriginId,
    );
    const sourceSpan = sourceWindow.end - sourceWindow.start;
    if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
      continue;
    }

    const outputWindow = timelineState?.authored === true
      ? timelineState.window
      : DEFAULT_TIMELINE_WINDOW;
    const outputSpan = outputWindow.end - outputWindow.start;
    if (!Number.isFinite(outputSpan) || outputSpan <= 0) {
      continue;
    }

    mappings.set(originId, {
      outputWindow,
      mapOutputBeatToSourceBeat: (outputBeat) => {
        if (outputBeat < outputWindow.start || outputBeat >= outputWindow.end) {
          return null;
        }

        const normalized = (outputBeat - outputWindow.start) / outputSpan;
        const remapped = evaluateTemporalRemap(remap, normalized);
        if (remapped === null || !Number.isFinite(remapped)) {
          return null;
        }

        return sourceWindow.start + sourceSpan * remapped;
      },
      nextTimelineState: {
        authored: true,
        window: outputWindow,
      },
    });
  }

  return mappings;
};

const resolveMaskSourceTimeReversed = (
  chain: GeneratorChain,
  targetGroupId: string | null,
  consumingDeviceIndex: number,
): boolean => {
  let reverseParity = false;

  for (let index = chain.devices.length - 1; index > consumingDeviceIndex; index -= 1) {
    const device = chain.devices[index];
    const deviceGroupId = normalizeOptionalId(device.groupId);
    const affectsTarget = deviceGroupId === null || deviceGroupId === targetGroupId;
    if (
      affectsTarget
      && isDeviceEffectivelyEnabled(chain, device)
      && doesDeviceToggleTimelineParity(device)
    ) {
      reverseParity = !reverseParity;
    }
  }

  return reverseParity;
};

const collectSourceFrameCells = (
  tape: LedTape,
  frameIndex: number,
  predicate: (cell: LedCell) => boolean,
): LedCell[] => {
  if (frameIndex < 0 || frameIndex >= tape.frames.length) {
    return [];
  }

  return tape.frames[frameIndex].cells
    .filter(predicate)
    .map((cell) => ({ ...cell }));
};

const resolveMaskSourceTiles = (
  tape: LedTape,
  chain: GeneratorChain,
  effect: MaskEffectNode,
  consumingDeviceIndex: number,
  runtimeMap: RuntimeMapData,
  targetGroupId: string | null,
  frameIndex: number,
): Set<number> => {
  if (effect.params.sourceKind === 'tiles') {
    return new Set(effect.params.tiles);
  }

  const sourceId = normalizeOptionalId(effect.params.sourceId);
  if (!sourceId) {
    return new Set<number>();
  }

  const isTimeReversed = resolveMaskSourceTimeReversed(
    chain,
    targetGroupId,
    consumingDeviceIndex,
  );
  const resolvedFrameIndex = isTimeReversed
    ? Math.max(tape.frames.length - 1 - frameIndex, 0)
    : frameIndex;

  const sourceCells = collectSourceFrameCells(
    tape,
    resolvedFrameIndex,
    effect.params.sourceKind === 'group'
      ? (cell) => cell.originGroupId === sourceId
      : (cell) => cell.originId === sourceId,
  );

  if (effect.params.sourceDomain === 'scene') {
    const tiles = new Set<number>();
    for (const cell of sourceCells) {
      const tileId = toRoundedTileId(cell.x, cell.y);
      if (tileId !== null) {
        tiles.add(tileId);
      }
    }
    return tiles;
  }

  return resolveProjectedActiveTiles(
    sourceCells,
    buildCoordinateGroupByKey(runtimeMap.buttonIndex),
  );
};

const applyMaskEffect = (
  state: MutableGenerationState,
  chain: GeneratorChain,
  effect: MaskEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  consumingDeviceIndex: number,
  runtimeMap: RuntimeMapData,
): MutableGenerationState => {
  const nextTape = createEmptyTape(state.tape.sampleStepBeats, state.tape.timeDomainEndBeat);
  nextTape.nextWriteId = state.tape.nextWriteId;
  ensureTapeFrameCount(nextTape, state.tape.timeDomainEndBeat);

  for (let frameIndex = 0; frameIndex < state.tape.frames.length; frameIndex += 1) {
    const maskTiles = resolveMaskSourceTiles(
      state.tape,
      chain,
      effect,
      consumingDeviceIndex,
      runtimeMap,
      targetGroupId,
      frameIndex,
    );

    for (const cell of state.tape.frames[frameIndex].cells) {
      if (!isTargetedCell(cell, targetGroupId)) {
        nextTape.frames[frameIndex].cells.push({ ...cell });
        continue;
      }

      const tileId = toRoundedTileId(cell.x, cell.y);
      if (tileId === null) {
        continue;
      }

      const isIncluded = maskTiles.has(tileId);
      const shouldKeep = effect.params.mode === 'include' ? isIncluded : !isIncluded;
      if (!shouldKeep) {
        continue;
      }

      addCellToFrame(nextTape, frameIndex, {
        x: cell.x,
        y: cell.y,
        velocity: cell.velocity,
        originId: cell.originId,
        originGroupId: cell.originGroupId,
        writeOrder,
      });
    }
  }

  return {
    tape: finalizeTape(nextTape),
    timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
  };
};

const collectNotesForOrigin = (
  tape: LedTape,
  originId: string,
  runtimeMap: RuntimeMapData,
): ClipNoteWithOrigin[] => projectTapeToNotes(
  {
    ...tape,
    frames: tape.frames.map((frame) => ({
      cells: frame.cells.filter((cell) => cell.originId === originId),
    })),
  },
  runtimeMap,
  new Set<string>(),
  new Set<string>(),
);

const resolveOriginGroupId = (
  tape: LedTape,
  originId: string,
): string | null => {
  for (const frame of tape.frames) {
    const matchingCell = frame.cells.find((cell) => cell.originId === originId);
    if (matchingCell) {
      return matchingCell.originGroupId;
    }
  }

  return null;
};

const applyColorEffect = (
  state: MutableGenerationState,
  effect: ColorEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  runtimeMap: RuntimeMapData,
): MutableGenerationState => {
  const nextTape = createEmptyTape(state.tape.sampleStepBeats, state.tape.timeDomainEndBeat);
  nextTape.nextWriteId = state.tape.nextWriteId;
  const targetOriginIds = buildTargetOriginIds(state.tape, targetGroupId);
  const buttonCoordinateByAddress = buildButtonCoordinateByAddress(runtimeMap.buttons);

  for (let frameIndex = 0; frameIndex < state.tape.frames.length; frameIndex += 1) {
    for (const cell of state.tape.frames[frameIndex].cells) {
      if (isTargetedCell(cell, targetGroupId)) {
        continue;
      }

      nextTape.frames[frameIndex].cells.push({ ...cell });
    }
  }

  for (const originId of targetOriginIds) {
    const originNotes = collectNotesForOrigin(state.tape, originId, runtimeMap);
    const slots = planColorProgramSlots(originNotes, buildColorConfig(effect));
    if (slots.length === 0) {
      continue;
    }

    const originGroupId = resolveOriginGroupId(state.tape, originId);
    for (const slot of slots) {
      const coordinate = buttonCoordinateByAddress.get(
        `${slot.sourceNote.channel}:${slot.sourceNote.pitch}`,
      );
      if (!coordinate) {
        continue;
      }

      ensureTapeFrameCount(nextTape, slot.endBeat);
      const startFrame = Math.max(Math.floor(slot.startBeat / nextTape.sampleStepBeats), 0);
      const endFrameExclusive = Math.min(
        Math.ceil(slot.endBeat / nextTape.sampleStepBeats),
        nextTape.frames.length,
      );

      for (let frameIndex = startFrame; frameIndex < endFrameExclusive; frameIndex += 1) {
        addCellToFrame(nextTape, frameIndex, {
          x: coordinate.x,
          y: coordinate.y,
          velocity: slot.velocity,
          originId,
          originGroupId,
          writeOrder,
        });
      }
    }
  }

  return {
    tape: finalizeTape(nextTape),
    timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
  };
};

const resolveEffectTransform = (
  effect: GeneratorEffectNode,
): ReturnType<typeof toTranslationTransform> | null => {
  if (effect.kind === 'mirror') {
    return toMirrorTransformAt(effect.params.angleDeg, COMPOSITION_CENTER);
  }

  if (effect.kind === 'rotate') {
    return toRotateTransformAt(effect.params.angleDeg, COMPOSITION_CENTER);
  }

  if (effect.kind === 'translate') {
    return toTranslationTransform(effect.params.offsetX, effect.params.offsetY);
  }

  if (effect.kind === 'scale') {
    return toScaleTransformAt(
      effect.params.scaleX,
      effect.params.scaleY,
      {
        x: effect.params.centerX,
        y: effect.params.centerY,
      },
    );
  }

  return null;
};

const applyEffectDevice = (
  state: MutableGenerationState,
  chain: GeneratorChain,
  device: GeneratorEffectNode,
  deviceIndex: number,
  runtimeMap: RuntimeMapData,
): MutableGenerationState => {
  const targetGroupId = normalizeOptionalId(device.groupId);

  if (device.kind === 'mask') {
    return applyMaskEffect(
      state,
      chain,
      device,
      targetGroupId,
      deviceIndex,
      deviceIndex,
      runtimeMap,
    );
  }

  if (device.kind === 'color') {
    return applyColorEffect(
      state,
      device,
      targetGroupId,
      deviceIndex,
      runtimeMap,
    );
  }

  if (device.kind === 'symmetry') {
    return applySymmetryEffect(state, device, targetGroupId, deviceIndex);
  }

  if (device.kind === 'reverse') {
    const mappings = buildReverseMappings(state, targetGroupId);
    return mappings.size > 0
      ? applyTemporalRemap(state, targetGroupId, mappings, deviceIndex)
      : {
          tape: cloneTape(state.tape),
          timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
        };
  }

  if (device.kind === 'trim') {
    const mappings = buildTrimMappings(state, device, targetGroupId);
    return mappings.size > 0
      ? applyTemporalRemap(state, targetGroupId, mappings, deviceIndex)
      : {
          tape: cloneTape(state.tape),
          timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
        };
  }

  if (device.kind === 'stretch') {
    const mappings = buildStretchMappings(state, device, targetGroupId);
    return mappings.size > 0
      ? applyTemporalRemap(state, targetGroupId, mappings, deviceIndex)
      : {
          tape: cloneTape(state.tape),
          timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
        };
  }

  if (device.kind === 'timewarp') {
    const mappings = buildTimeWarpMappings(state, device, targetGroupId);
    return mappings.size > 0
      ? applyTemporalRemap(state, targetGroupId, mappings, deviceIndex)
      : {
          tape: cloneTape(state.tape),
          timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
        };
  }

  return applySpatialTransform(
    state,
    targetGroupId,
    deviceIndex,
    resolveEffectTransform(device),
  );
};

const applyGeneratorDevice = (
  state: MutableGenerationState,
  device: GeneratorNode,
  deviceIndex: number,
): MutableGenerationState => {
  const nextTape = cloneTape(state.tape);
  nextTape.nextWriteId = state.tape.nextWriteId;
  ensureTapeFrameCount(nextTape, 1);

  for (let frameIndex = 0; frameIndex < Math.min(nextTape.frames.length, 256); frameIndex += 1) {
    rasterizeGeneratorFrame(nextTape, frameIndex, device, deviceIndex);
  }

  const nextTimelineStateByOriginId = cloneTimelineStateByOriginId(state.timelineStateByOriginId);
  nextTimelineStateByOriginId.set(device.id, {
    authored: false,
    window: DEFAULT_TIMELINE_WINDOW,
  });

  return {
    tape: finalizeTape(nextTape),
    timelineStateByOriginId: nextTimelineStateByOriginId,
  };
};

export const buildCanonicalFieldResult = (
  chain: GeneratorChain,
  runtimeMap: RuntimeMapData,
): GeneratedFieldResult => {
  const baseChain = stripModulationDevicesFromChain(chain);
  let currentState: MutableGenerationState = {
    tape: createEmptyTape(),
    timelineStateByOriginId: new Map<string, OriginTimelineState>(),
  };

  for (let deviceIndex = 0; deviceIndex < baseChain.devices.length; deviceIndex += 1) {
    const device = baseChain.devices[deviceIndex];
    if (!isDeviceEffectivelyEnabled(baseChain, device)) {
      continue;
    }

    if (device.kind === 'waterdrop'
      || device.kind === 'scanner'
      || device.kind === 'spiral'
      || device.kind === 'path') {
      currentState = applyGeneratorDevice(currentState, device, deviceIndex);
      continue;
    }

    if (device.kind === 'modulator') {
      continue;
    }

    currentState = applyEffectDevice(
      currentState,
      baseChain,
      device,
      deviceIndex,
      runtimeMap,
    );
  }

  const tape = finalizeTape(currentState.tape);
  const { mutedGroupIds, mutedGeneratorIds } = resolveMutedSources(baseChain);
  const ledFramesBySampleIndex = buildLedFramesBySampleIndex(
    tape,
    runtimeMap,
    mutedGroupIds,
    mutedGeneratorIds,
  );
  const notes = projectTapeToNotes(
    tape,
    runtimeMap,
    mutedGroupIds,
    mutedGeneratorIds,
  );

  return {
    tape,
    notes,
    sourceTimelineEndBeat: tape.timeDomainEndBeat,
    sampleStepBeats: tape.sampleStepBeats,
    ledFramesBySampleIndex,
  };
};
