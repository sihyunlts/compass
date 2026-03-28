import { composeAffine, COMPOSITION_CENTER, applyAffine, toAxisMirrorTransformAt, toMirrorTransformAt, toRotateTransformAt, toScaleTransformAt, toTranslationTransform } from '../core/geometry';
import {
  applyModulationProgramToChain,
  compileModulationProgram,
  type CompiledModulationProgram,
} from '../core/modulation/compiled-program';
import { resolveMutedSources } from '../core/pipeline/groups';
import { stripModulationDevicesFromChain } from '../core/modulation/routing';
import { evaluateTemporalRemap } from '../core/scene-operators/temporal';
import { createSampledRemapFromTimeWarpCurve, isIdentityTimeWarpCurve } from '../core/timewarp/curve';
import {
  buildColorConfig,
  planColorProgramSlots,
} from '../devices/color/color-program';
import { doesDeviceToggleTimelineParity } from '../devices/timeline-parity';
import { isDeviceEffectivelyEnabled } from '../shared/group-state';
import { cloneDeviceNode } from '../shared/model';
import type {
  ColorEffectNode,
  GeneratorChain,
  GeneratorDeviceNode,
  GeneratorEffectNode,
  GeneratorNode,
  MaskEffectNode,
  StretchEffectNode,
  SymmetryEffectNode,
  TimeWarpEffectNode,
  TrimEffectNode,
} from '../shared/model';
import { normalizeOptionalId } from '../shared/normalize-id';
import { rasterizeGeneratorFrame } from './raster';
import {
  containsPointInSpatialRequirement,
} from './analysis/bounds';
import { buildCanonicalExecutionPlan } from './analysis/execution-plan';
import { buildCanonicalAnalysisResult } from './analysis/operators';
import type {
  BeatRange,
  CanonicalExecutionRequest,
  OperatorExecutionPlan,
  SpatialRequirement,
} from './analysis/types';
import { collectActivationSegments, type LedActivationSegment } from './tape-analysis';
import {
  addCellToFrame,
  cloneTape,
  createEmptyTape,
  ensureTapeFrameCount,
  finalizeTape,
  toFrameWindow,
  type FrameWindow,
} from './tape';
import type {
  CanonicalFieldResult,
  CanonicalSpatialAdapter,
  CanonicalSpatialMask,
  CanonicalSurfaceAdapter,
  LedCell,
  LedTape,
} from './types';

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

interface ModulationContext {
  loopLengthBeats: number;
  program: CompiledModulationProgram;
  deviceByFrameKey: Map<string, GeneratorDeviceNode>;
}

interface OriginTemporalRemap {
  nextTimelineAuthored: boolean;
  sourceFrameIndexByOutputFrame: ReadonlyArray<number | null>;
}

const DEFAULT_TIMELINE_WINDOW: TimelineWindow = Object.freeze({
  start: 0,
  end: 1,
});

const EMPTY_SPATIAL_MASK: CanonicalSpatialMask = Object.freeze({
  contains: () => false,
});

const FULL_EXECUTION_BOUNDS: SpatialRequirement = 'all';
const EMPTY_EXECUTION_PLAN: OperatorExecutionPlan = Object.freeze({
  requiredOutputBounds: FULL_EXECUTION_BOUNDS,
  requiredInputRoi: FULL_EXECUTION_BOUNDS,
  requiredSourceRoi: 'none',
  requiredFrameWindow: 'all',
  requiredSourceFrameWindow: 'none',
});

const resolveDeviceExecutionPlan = (
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>,
  deviceId: string,
): OperatorExecutionPlan => executionPlanByDeviceId.get(deviceId) ?? EMPTY_EXECUTION_PLAN;

const isCellWithinExecutionBounds = (
  x: number,
  y: number,
  executionBounds: SpatialRequirement,
): boolean => containsPointInSpatialRequirement(executionBounds, x, y);

const resolveFrameWindow = (
  requirement: BeatRange | 'all' | 'none',
  sampleStepBeats: number,
  frameCount: number,
): FrameWindow => {
  if (requirement === 'all') {
    return {
      startFrame: 0,
      endFrameExclusive: frameCount,
    };
  }

  if (requirement === 'none') {
    return {
      startFrame: 0,
      endFrameExclusive: 0,
    };
  }

  return toFrameWindow(requirement, sampleStepBeats, frameCount);
};

const isFrameWithinWindow = (
  frameIndex: number,
  window: FrameWindow,
): boolean => frameIndex >= window.startFrame && frameIndex < window.endFrameExclusive;

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

const createModulationContext = (
  chain: GeneratorChain,
  loopLengthBeats: number,
): ModulationContext => ({
  loopLengthBeats,
  program: compileModulationProgram(chain),
  deviceByFrameKey: new Map<string, GeneratorDeviceNode>(),
});

const resolveModulatedDeviceAtFrame = <T extends GeneratorDeviceNode>(
  context: ModulationContext,
  device: T,
  frameIndex: number,
  sampleStepBeats: number,
): T => {
  if (context.program.routes.length === 0) {
    return device;
  }

  const cacheKey = `${device.id}:${frameIndex}`;
  const cached = context.deviceByFrameKey.get(cacheKey);
  if (cached) {
    return cached as T;
  }

  const snapshot = cloneDeviceNode(device) as T;
  applyModulationProgramToChain(
    context.program,
    {
      devices: [snapshot],
      groupStateById: {},
    },
    new Map<string, GeneratorDeviceNode>([[snapshot.id, snapshot]]),
    frameIndex * sampleStepBeats,
    context.loopLengthBeats,
    { wrap: true },
  );
  context.deviceByFrameKey.set(cacheKey, snapshot);
  return snapshot;
};

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
  resolveTransformAtFrame: (frameIndex: number) => ReturnType<typeof toTranslationTransform> | null,
  executionBounds: SpatialRequirement,
  requiredFrameWindow: BeatRange | 'all',
): MutableGenerationState => {
  const nextTape = createEmptyTape(state.tape.sampleStepBeats, state.tape.timeDomainEndBeat);
  nextTape.nextWriteId = state.tape.nextWriteId;
  ensureTapeFrameCount(nextTape, state.tape.timeDomainEndBeat);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.tape.sampleStepBeats,
    state.tape.frames.length,
  );

  for (let frameIndex = 0; frameIndex < state.tape.frames.length; frameIndex += 1) {
    const transform = resolveTransformAtFrame(frameIndex);
    const { targeted, untargeted } = splitFrameCellsByTarget(
      state.tape.frames[frameIndex].cells,
      targetGroupId,
    );
    nextTape.frames[frameIndex].cells.push(...untargeted);

    if (!isFrameWithinWindow(frameIndex, frameWindow)) {
      continue;
    }

    for (const cell of targeted) {
      if (!transform) {
        if (!isCellWithinExecutionBounds(cell.x, cell.y, executionBounds)) {
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
        continue;
      }

      const point = applyAffine(transform, { x: cell.x, y: cell.y });
      if (!isCellWithinExecutionBounds(point.x, point.y, executionBounds)) {
        continue;
      }

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
  executionBounds: SpatialRequirement,
  requiredFrameWindow: BeatRange | 'all',
): MutableGenerationState => {
  const nextTape = createEmptyTape(state.tape.sampleStepBeats, state.tape.timeDomainEndBeat);
  nextTape.nextWriteId = state.tape.nextWriteId;
  ensureTapeFrameCount(nextTape, state.tape.timeDomainEndBeat);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.tape.sampleStepBeats,
    state.tape.frames.length,
  );

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

    if (!isFrameWithinWindow(frameIndex, frameWindow)) {
      continue;
    }

    for (const cell of targeted) {
      const sourceCoordinate = effect.params.axis === 'horizontal' ? cell.x : cell.y;
      const boundary = effect.params.axis === 'horizontal' ? COMPOSITION_CENTER.x : COMPOSITION_CENTER.y;
      if (
        isWithinHalfBoundary(sourceCoordinate, boundary, keepMin)
        && isCellWithinExecutionBounds(cell.x, cell.y, executionBounds)
      ) {
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
      if (!isCellWithinExecutionBounds(mirrored.x, mirrored.y, executionBounds)) {
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
  executionBounds: SpatialRequirement,
  requiredFrameWindow: BeatRange | 'all',
): MutableGenerationState => {
  const nextTape = createEmptyTape(state.tape.sampleStepBeats, state.tape.timeDomainEndBeat);
  nextTape.nextWriteId = state.tape.nextWriteId;
  ensureTapeFrameCount(nextTape, state.tape.timeDomainEndBeat);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.tape.sampleStepBeats,
    state.tape.frames.length,
  );

  const quadrants: ReadonlyArray<SymmetryEffectNode['params']['sourceAnchor']> = ['bl', 'br', 'tr', 'tl'];
  const sourceKeepMinX = effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'tl';
  const sourceKeepMinY = effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'br';

  for (let frameIndex = 0; frameIndex < state.tape.frames.length; frameIndex += 1) {
    const { targeted, untargeted } = splitFrameCellsByTarget(
      state.tape.frames[frameIndex].cells,
      targetGroupId,
    );
    nextTape.frames[frameIndex].cells.push(...untargeted);

    if (!isFrameWithinWindow(frameIndex, frameWindow)) {
      continue;
    }

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
        if (!isCellWithinExecutionBounds(transformed.x, transformed.y, executionBounds)) {
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
  executionBounds: SpatialRequirement,
  requiredFrameWindow: BeatRange | 'all',
): MutableGenerationState => {
  const nextTape = createEmptyTape(state.tape.sampleStepBeats, state.tape.timeDomainEndBeat);
  nextTape.nextWriteId = state.tape.nextWriteId;
  ensureTapeFrameCount(nextTape, state.tape.timeDomainEndBeat);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.tape.sampleStepBeats,
    state.tape.frames.length,
  );

  const quadrants: ReadonlyArray<SymmetryEffectNode['params']['sourceAnchor']> = ['bl', 'br', 'tr', 'tl'];
  const sourceIndex = quadrants.findIndex((quadrant) => quadrant === effect.params.sourceAnchor);

  for (let frameIndex = 0; frameIndex < state.tape.frames.length; frameIndex += 1) {
    const { targeted, untargeted } = splitFrameCellsByTarget(
      state.tape.frames[frameIndex].cells,
      targetGroupId,
    );
    nextTape.frames[frameIndex].cells.push(...untargeted);

    if (!isFrameWithinWindow(frameIndex, frameWindow)) {
      continue;
    }

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
        if (!isCellWithinExecutionBounds(transformed.x, transformed.y, executionBounds)) {
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
  executionBounds: SpatialRequirement,
  requiredFrameWindow: BeatRange | 'all',
): MutableGenerationState => {
  if (effect.params.mode === 'mirror-half') {
    return applyMirrorHalfSymmetry(
      state,
      effect,
      targetGroupId,
      writeOrder,
      executionBounds,
      requiredFrameWindow,
    );
  }

  if (effect.params.mode === 'quad-mirror') {
    return applyQuadMirrorSymmetry(
      state,
      effect,
      targetGroupId,
      writeOrder,
      executionBounds,
      requiredFrameWindow,
    );
  }

  return applyQuadPinwheelSymmetry(
    state,
    effect,
    targetGroupId,
    writeOrder,
    executionBounds,
    requiredFrameWindow,
  );
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

const resolveTemporalOutputFrameCount = (
  state: MutableGenerationState,
  targetGroupId: string | null,
): number => {
  let maxEndBeat = state.tape.timeDomainEndBeat;
  const occupiedWindowByOriginId = buildOccupiedWindowByOriginId(state.tape);

  for (const originId of buildTargetOriginIds(state.tape, targetGroupId)) {
    const sourceWindow = resolveSourceWindow(
      originId,
      state.timelineStateByOriginId,
      occupiedWindowByOriginId,
    );
    if (sourceWindow.end > maxEndBeat) {
      maxEndBeat = sourceWindow.end;
    }

    const timelineState = state.timelineStateByOriginId.get(originId);
    if (timelineState && timelineState.window.end > maxEndBeat) {
      maxEndBeat = timelineState.window.end;
    }
  }

  return Math.max(Math.ceil(maxEndBeat / state.tape.sampleStepBeats), 1);
};

const toSourceFrameIndex = (
  beat: number,
  tape: LedTape,
): number => {
  const frameCount = Math.max(tape.frames.length, 1);
  return Math.min(
    Math.max(Math.floor(beat / tape.sampleStepBeats), 0),
    frameCount - 1,
  );
};

const hasMappedSourceFrame = (
  sourceFrameIndexByOutputFrame: ReadonlyArray<number | null>,
): boolean => sourceFrameIndexByOutputFrame.some((frameIndex) => frameIndex !== null);

const applyTemporalRemap = (
  state: MutableGenerationState,
  targetGroupId: string | null,
  remaps: ReadonlyMap<string, OriginTemporalRemap>,
  writeOrder: number,
  requiredFrameWindow: BeatRange | 'all',
): MutableGenerationState => {
  const passthroughEndBeat = resolvePassthroughEndBeat(state.tape, targetGroupId);
  const passthroughFrameCount = Math.max(
    Math.ceil(passthroughEndBeat / state.tape.sampleStepBeats),
    1,
  );
  let outputFrameCount = passthroughFrameCount;
  for (const remap of remaps.values()) {
    if (remap.sourceFrameIndexByOutputFrame.length > outputFrameCount) {
      outputFrameCount = remap.sourceFrameIndexByOutputFrame.length;
    }
  }
  const outputEndBeat = outputFrameCount * state.tape.sampleStepBeats;
  const nextTape = createEmptyTape(state.tape.sampleStepBeats, outputEndBeat);
  nextTape.nextWriteId = state.tape.nextWriteId;
  ensureTapeFrameCount(nextTape, outputEndBeat);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.tape.sampleStepBeats,
    nextTape.frames.length,
  );

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
  for (const [originId, remap] of remaps.entries()) {
    const sourceCellsByFrame = sourceCellsByOriginAndFrame.get(originId);
    if (!sourceCellsByFrame) {
      continue;
    }

    for (
      let frameIndex = 0;
      frameIndex < Math.min(remap.sourceFrameIndexByOutputFrame.length, nextTape.frames.length);
      frameIndex += 1
    ) {
      if (!isFrameWithinWindow(frameIndex, frameWindow)) {
        continue;
      }

      const sourceFrameIndex = remap.sourceFrameIndexByOutputFrame[frameIndex];
      if (sourceFrameIndex === null || sourceFrameIndex === undefined) {
        continue;
      }

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

  const finalizedTape = finalizeTape(nextTape);
  const occupiedWindowByOriginId = buildOccupiedWindowByOriginId(finalizedTape);
  const nextTimelineStateByOriginId = cloneTimelineStateByOriginId(state.timelineStateByOriginId);
  for (const [originId, remap] of remaps.entries()) {
    const occupiedWindow = occupiedWindowByOriginId.get(originId)
      ?? state.timelineStateByOriginId.get(originId)?.window
      ?? DEFAULT_TIMELINE_WINDOW;
    nextTimelineStateByOriginId.set(originId, {
      authored: remap.nextTimelineAuthored,
      window: {
        start: occupiedWindow.start,
        end: occupiedWindow.end,
      },
    });
  }

  return {
    tape: finalizedTape,
    timelineStateByOriginId: nextTimelineStateByOriginId,
  };
};

const buildReverseRemaps = (
  state: MutableGenerationState,
  targetGroupId: string | null,
  requiredFrameWindow: BeatRange | 'all',
): Map<string, OriginTemporalRemap> => {
  const remaps = new Map<string, OriginTemporalRemap>();
  const occupiedWindowByOriginId = buildOccupiedWindowByOriginId(state.tape);
  const outputFrameCount = resolveTemporalOutputFrameCount(state, targetGroupId);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.tape.sampleStepBeats,
    outputFrameCount,
  );

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

    const sourceFrameIndexByOutputFrame: Array<number | null> = Array.from(
      { length: outputFrameCount },
      (_, frameIndex) => {
        if (!isFrameWithinWindow(frameIndex, frameWindow)) {
          return null;
        }

        const outputBeat = frameIndex * state.tape.sampleStepBeats;
        if (outputBeat < outputWindow.start || outputBeat >= outputWindow.end) {
          return null;
        }

        const normalizedEnd = Math.min(
          Math.max(((outputBeat + state.tape.sampleStepBeats) - outputWindow.start) / outputSpan, 0),
          1,
        );
        return toSourceFrameIndex(
          sourceWindow.start + sourceSpan * (1 - normalizedEnd),
          state.tape,
        );
      },
    );
    if (!hasMappedSourceFrame(sourceFrameIndexByOutputFrame)) {
      continue;
    }

    remaps.set(originId, {
      nextTimelineAuthored: timelineState?.authored === true,
      sourceFrameIndexByOutputFrame,
    });
  }

  return remaps;
};

const buildTrimRemaps = (
  state: MutableGenerationState,
  effect: TrimEffectNode,
  targetGroupId: string | null,
  modulationContext: ModulationContext,
  requiredFrameWindow: BeatRange | 'all',
): Map<string, OriginTemporalRemap> => {
  const remaps = new Map<string, OriginTemporalRemap>();
  const occupiedWindowByOriginId = buildOccupiedWindowByOriginId(state.tape);
  const outputFrameCount = resolveTemporalOutputFrameCount(state, targetGroupId);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.tape.sampleStepBeats,
    outputFrameCount,
  );

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

    const sourceFrameIndexByOutputFrame: Array<number | null> = Array.from(
      { length: outputFrameCount },
      (_, frameIndex) => {
        if (!isFrameWithinWindow(frameIndex, frameWindow)) {
          return null;
        }

        const outputBeat = frameIndex * state.tape.sampleStepBeats;
        if (outputBeat < outputWindow.start || outputBeat >= outputWindow.end) {
          return null;
        }

        const deviceAtFrame = resolveModulatedDeviceAtFrame(
          modulationContext,
          effect,
          frameIndex,
          state.tape.sampleStepBeats,
        );
        const start = deviceAtFrame.params.start;
        const end = deviceAtFrame.params.end;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1 || end <= start) {
          return null;
        }

        const normalized = (outputBeat - outputWindow.start) / outputSpan;
        return toSourceFrameIndex(
          sourceWindow.start + sourceSpan * (start + normalized * (end - start)),
          state.tape,
        );
      },
    );
    if (!hasMappedSourceFrame(sourceFrameIndexByOutputFrame)) {
      continue;
    }

    remaps.set(originId, {
      nextTimelineAuthored: true,
      sourceFrameIndexByOutputFrame,
    });
  }

  return remaps;
};

const buildStretchRemaps = (
  state: MutableGenerationState,
  effect: StretchEffectNode,
  targetGroupId: string | null,
  modulationContext: ModulationContext,
  requiredFrameWindow: BeatRange | 'all',
): Map<string, OriginTemporalRemap> => {
  const remaps = new Map<string, OriginTemporalRemap>();
  const occupiedWindowByOriginId = buildOccupiedWindowByOriginId(state.tape);
  const outputFrameCount = resolveTemporalOutputFrameCount(state, targetGroupId);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.tape.sampleStepBeats,
    outputFrameCount,
  );

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

    const sourceFrameIndexByOutputFrame: Array<number | null> = Array.from(
      { length: outputFrameCount },
      (_, frameIndex) => {
        if (!isFrameWithinWindow(frameIndex, frameWindow)) {
          return null;
        }

        const outputBeat = frameIndex * state.tape.sampleStepBeats;
        const deviceAtFrame = resolveModulatedDeviceAtFrame(
          modulationContext,
          effect,
          frameIndex,
          state.tape.sampleStepBeats,
        );
        const start = deviceAtFrame.params.start;
        const end = deviceAtFrame.params.end;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1 || end <= start) {
          return null;
        }

        if (outputBeat < start || outputBeat >= end) {
          return null;
        }

        const normalized = (outputBeat - start) / (end - start);
        return toSourceFrameIndex(
          sourceWindow.start + sourceSpan * normalized,
          state.tape,
        );
      },
    );
    if (!hasMappedSourceFrame(sourceFrameIndexByOutputFrame)) {
      continue;
    }

    remaps.set(originId, {
      nextTimelineAuthored: true,
      sourceFrameIndexByOutputFrame,
    });
  }

  return remaps;
};

const buildTimeWarpRemaps = (
  state: MutableGenerationState,
  effect: TimeWarpEffectNode,
  targetGroupId: string | null,
  requiredFrameWindow: BeatRange | 'all',
): Map<string, OriginTemporalRemap> => {
  const remaps = new Map<string, OriginTemporalRemap>();
  if (isIdentityTimeWarpCurve(effect.params.curve)) {
    return remaps;
  }

  const remap = createSampledRemapFromTimeWarpCurve(effect.params.curve);
  const occupiedWindowByOriginId = buildOccupiedWindowByOriginId(state.tape);
  const outputFrameCount = resolveTemporalOutputFrameCount(state, targetGroupId);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.tape.sampleStepBeats,
    outputFrameCount,
  );

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

    const sourceFrameIndexByOutputFrame: Array<number | null> = Array.from(
      { length: outputFrameCount },
      (_, frameIndex) => {
        if (!isFrameWithinWindow(frameIndex, frameWindow)) {
          return null;
        }

        const outputBeat = frameIndex * state.tape.sampleStepBeats;
        if (outputBeat < outputWindow.start || outputBeat >= outputWindow.end) {
          return null;
        }

        const normalized = (outputBeat - outputWindow.start) / outputSpan;
        const remappedBeat = evaluateTemporalRemap(remap, normalized);
        if (remappedBeat === null || !Number.isFinite(remappedBeat)) {
          return null;
        }

        return toSourceFrameIndex(
          sourceWindow.start + sourceSpan * remappedBeat,
          state.tape,
        );
      },
    );
    if (!hasMappedSourceFrame(sourceFrameIndexByOutputFrame)) {
      continue;
    }

    remaps.set(originId, {
      nextTimelineAuthored: true,
      sourceFrameIndexByOutputFrame,
    });
  }

  return remaps;
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
  sourceRoi: SpatialRequirement = FULL_EXECUTION_BOUNDS,
): LedCell[] => {
  if (frameIndex < 0 || frameIndex >= tape.frames.length) {
    return [];
  }

  return tape.frames[frameIndex].cells
    .filter((cell) =>
      predicate(cell) && isCellWithinExecutionBounds(cell.x, cell.y, sourceRoi))
    .map((cell) => ({ ...cell }));
};

const resolveMaskSourceMask = (
  sourceTape: LedTape,
  chain: GeneratorChain,
  effect: MaskEffectNode,
  consumingDeviceIndex: number,
  surfaceAdapter: CanonicalSurfaceAdapter,
  spatialAdapter: CanonicalSpatialAdapter,
  targetGroupId: string | null,
  frameIndex: number,
  sourceRoi: SpatialRequirement,
): CanonicalSpatialMask => {
  if (effect.params.sourceKind === 'tiles') {
    return spatialAdapter.createMaskFromViewportTiles(effect.params.tiles);
  }

  const sourceId = normalizeOptionalId(effect.params.sourceId);
  if (!sourceId) {
    return EMPTY_SPATIAL_MASK;
  }

  const isTimeReversed = resolveMaskSourceTimeReversed(
    chain,
    targetGroupId,
    consumingDeviceIndex,
  );
  const resolvedFrameIndex = isTimeReversed
    ? Math.max(sourceTape.frames.length - 1 - frameIndex, 0)
    : frameIndex;

  const sourceCells = collectSourceFrameCells(
    sourceTape,
    resolvedFrameIndex,
    effect.params.sourceKind === 'group'
      ? (cell) => cell.originGroupId === sourceId
      : (cell) => cell.originId === sourceId,
    sourceRoi,
  );

  if (effect.params.sourceDomain === 'scene') {
    return spatialAdapter.createMaskFromSceneCells(sourceCells);
  }

  return spatialAdapter.createMaskFromViewportTiles(
    surfaceAdapter.projectActivationTiles(sourceCells),
  );
};

const applyMaskEffect = (
  state: MutableGenerationState,
  chain: GeneratorChain,
  effect: MaskEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  consumingDeviceIndex: number,
  surfaceAdapter: CanonicalSurfaceAdapter,
  spatialAdapter: CanonicalSpatialAdapter,
  executionPlan: OperatorExecutionPlan,
): MutableGenerationState => {
  const sourceTape = state.tape;
  const nextTape = createEmptyTape(state.tape.sampleStepBeats, state.tape.timeDomainEndBeat);
  nextTape.nextWriteId = state.tape.nextWriteId;
  ensureTapeFrameCount(nextTape, state.tape.timeDomainEndBeat);
  const targetFrameWindow = resolveFrameWindow(
    executionPlan.requiredFrameWindow,
    state.tape.sampleStepBeats,
    sourceTape.frames.length,
  );
  const sourceFrameWindow = resolveFrameWindow(
    executionPlan.requiredSourceFrameWindow,
    state.tape.sampleStepBeats,
    sourceTape.frames.length,
  );

  for (let frameIndex = 0; frameIndex < sourceTape.frames.length; frameIndex += 1) {
    const mask = resolveMaskSourceMask(
      sourceTape,
      chain,
      effect,
      consumingDeviceIndex,
      surfaceAdapter,
      spatialAdapter,
      targetGroupId,
      frameIndex,
      isFrameWithinWindow(frameIndex, sourceFrameWindow)
        ? executionPlan.requiredSourceRoi
        : 'none',
    );

    for (const cell of sourceTape.frames[frameIndex].cells) {
      if (!isTargetedCell(cell, targetGroupId)) {
        nextTape.frames[frameIndex].cells.push({ ...cell });
        continue;
      }

      if (!isFrameWithinWindow(frameIndex, targetFrameWindow)) {
        continue;
      }

      if (!isCellWithinExecutionBounds(cell.x, cell.y, executionPlan.requiredOutputBounds)) {
        continue;
      }

      const isIncluded = mask.contains(cell.x, cell.y);
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

const groupActivationSegmentsByOriginId = (
  segments: ReadonlyArray<LedActivationSegment>,
): Map<string, LedActivationSegment[]> => {
  const segmentsByOriginId = new Map<string, LedActivationSegment[]>();

  for (const segment of segments) {
    const existingSegments = segmentsByOriginId.get(segment.originId);
    if (existingSegments) {
      existingSegments.push(segment);
      continue;
    }

    segmentsByOriginId.set(segment.originId, [segment]);
  }

  return segmentsByOriginId;
};

const applyColorEffect = (
  state: MutableGenerationState,
  effect: ColorEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  executionBounds: SpatialRequirement,
  requiredFrameWindow: BeatRange | 'all',
): MutableGenerationState => {
  const nextTape = createEmptyTape(state.tape.sampleStepBeats, state.tape.timeDomainEndBeat);
  nextTape.nextWriteId = state.tape.nextWriteId;
  const colorConfig = buildColorConfig(effect);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.tape.sampleStepBeats,
    state.tape.frames.length,
  );
  const targetSegmentsByOriginId = groupActivationSegmentsByOriginId(
    collectActivationSegments(
      state.tape,
      (cell) => isTargetedCell(cell, targetGroupId),
    ),
  );

  for (let frameIndex = 0; frameIndex < state.tape.frames.length; frameIndex += 1) {
    for (const cell of state.tape.frames[frameIndex].cells) {
      if (isTargetedCell(cell, targetGroupId)) {
        continue;
      }

      nextTape.frames[frameIndex].cells.push({ ...cell });
    }
  }

  for (const [originId, sourceSegments] of targetSegmentsByOriginId.entries()) {
    const slots = planColorProgramSlots(sourceSegments, colorConfig);
    if (slots.length === 0) {
      continue;
    }

    for (const slot of slots) {
      ensureTapeFrameCount(nextTape, slot.endBeat);
      const startFrame = Math.max(Math.floor(slot.startBeat / nextTape.sampleStepBeats), 0);
      const endFrameExclusive = Math.min(
        Math.ceil(slot.endBeat / nextTape.sampleStepBeats),
        nextTape.frames.length,
      );

      for (let frameIndex = startFrame; frameIndex < endFrameExclusive; frameIndex += 1) {
        if (!isFrameWithinWindow(frameIndex, frameWindow)) {
          continue;
        }

        if (!isCellWithinExecutionBounds(slot.source.x, slot.source.y, executionBounds)) {
          continue;
        }

        addCellToFrame(nextTape, frameIndex, {
          x: slot.source.x,
          y: slot.source.y,
          velocity: slot.velocity,
          originId,
          originGroupId: slot.source.originGroupId,
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

const cloneGenerationState = (
  state: MutableGenerationState,
): MutableGenerationState => ({
  tape: cloneTape(state.tape),
  timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
});

const applyEffectDevice = (
  state: MutableGenerationState,
  chain: GeneratorChain,
  device: GeneratorEffectNode,
  deviceIndex: number,
  surfaceAdapter: CanonicalSurfaceAdapter,
  spatialAdapter: CanonicalSpatialAdapter,
  modulationContext: ModulationContext,
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>,
): MutableGenerationState => {
  const targetGroupId = normalizeOptionalId(device.groupId);
  const executionPlan = resolveDeviceExecutionPlan(executionPlanByDeviceId, device.id);

  if (device.kind === 'mask') {
    return applyMaskEffect(
      state,
      chain,
      device,
      targetGroupId,
      deviceIndex,
      deviceIndex,
      surfaceAdapter,
      spatialAdapter,
      executionPlan,
    );
  }

  if (device.kind === 'color') {
    return applyColorEffect(
      state,
      device,
      targetGroupId,
      deviceIndex,
      executionPlan.requiredOutputBounds,
      executionPlan.requiredFrameWindow,
    );
  }

  if (device.kind === 'symmetry') {
    return applySymmetryEffect(
      state,
      device,
      targetGroupId,
      deviceIndex,
      executionPlan.requiredOutputBounds,
      executionPlan.requiredFrameWindow,
    );
  }

  if (device.kind === 'reverse') {
    const remaps = buildReverseRemaps(state, targetGroupId, executionPlan.requiredFrameWindow);
    return remaps.size > 0
      ? applyTemporalRemap(state, targetGroupId, remaps, deviceIndex, executionPlan.requiredFrameWindow)
      : cloneGenerationState(state);
  }

  if (device.kind === 'trim') {
    const remaps = buildTrimRemaps(
      state,
      device,
      targetGroupId,
      modulationContext,
      executionPlan.requiredFrameWindow,
    );
    return remaps.size > 0
      ? applyTemporalRemap(state, targetGroupId, remaps, deviceIndex, executionPlan.requiredFrameWindow)
      : cloneGenerationState(state);
  }

  if (device.kind === 'stretch') {
    const remaps = buildStretchRemaps(
      state,
      device,
      targetGroupId,
      modulationContext,
      executionPlan.requiredFrameWindow,
    );
    return remaps.size > 0
      ? applyTemporalRemap(state, targetGroupId, remaps, deviceIndex, executionPlan.requiredFrameWindow)
      : cloneGenerationState(state);
  }

  if (device.kind === 'timewarp') {
    const remaps = buildTimeWarpRemaps(
      state,
      device,
      targetGroupId,
      executionPlan.requiredFrameWindow,
    );
    return remaps.size > 0
      ? applyTemporalRemap(state, targetGroupId, remaps, deviceIndex, executionPlan.requiredFrameWindow)
      : cloneGenerationState(state);
  }

  return applySpatialTransform(
    state,
    targetGroupId,
    deviceIndex,
    (frameIndex) => resolveEffectTransform(
      resolveModulatedDeviceAtFrame(
        modulationContext,
        device,
        frameIndex,
        state.tape.sampleStepBeats,
      ) as GeneratorEffectNode,
    ),
    executionPlan.requiredOutputBounds,
    executionPlan.requiredFrameWindow,
  );
};

const applyGeneratorDevice = (
  state: MutableGenerationState,
  device: GeneratorNode,
  deviceIndex: number,
  modulationContext: ModulationContext,
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>,
): MutableGenerationState => {
  const nextTape = cloneTape(state.tape);
  nextTape.nextWriteId = state.tape.nextWriteId;
  ensureTapeFrameCount(nextTape, 1);
  const executionPlan = resolveDeviceExecutionPlan(executionPlanByDeviceId, device.id);
  const frameWindow = resolveFrameWindow(
    executionPlan.requiredFrameWindow,
    nextTape.sampleStepBeats,
    nextTape.frames.length,
  );

  for (let frameIndex = frameWindow.startFrame; frameIndex < frameWindow.endFrameExclusive; frameIndex += 1) {
    rasterizeGeneratorFrame(
      nextTape,
      frameIndex,
      resolveModulatedDeviceAtFrame(
        modulationContext,
        device,
        frameIndex,
        nextTape.sampleStepBeats,
      ) as GeneratorNode,
      deviceIndex,
      executionPlan.requiredOutputBounds,
    );
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
  loopLengthBeats: number,
  surfaceAdapter: CanonicalSurfaceAdapter,
  spatialAdapter: CanonicalSpatialAdapter,
  executionRequest: CanonicalExecutionRequest,
): CanonicalFieldResult => {
  const baseChain = stripModulationDevicesFromChain(chain);
  const modulationContext = createModulationContext(chain, loopLengthBeats);
  const executionPlan = buildCanonicalExecutionPlan(baseChain, executionRequest);
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
      currentState = applyGeneratorDevice(
        currentState,
        device,
        deviceIndex,
        modulationContext,
        executionPlan.byDeviceId,
      );
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
      surfaceAdapter,
      spatialAdapter,
      modulationContext,
      executionPlan.byDeviceId,
    );
  }

  const tape = finalizeTape(currentState.tape);
  const { mutedGroupIds, mutedGeneratorIds } = resolveMutedSources(baseChain);
  const analysis = buildCanonicalAnalysisResult(baseChain);

  return {
    tape,
    sourceTimelineEndBeat: tape.timeDomainEndBeat,
    sampleStepBeats: tape.sampleStepBeats,
    mutedGroupIds,
    mutedGeneratorIds,
    analysis,
    executionPlan,
  };
};
