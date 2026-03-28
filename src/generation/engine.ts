import { composeAffine, COMPOSITION_CENTER, applyAffine, toAxisMirrorTransformAt, toMirrorTransformAt, toRotateTransformAt, toScaleTransformAt, toTranslationTransform } from '../core/geometry';
import {
  applyModulationProgramToChain,
  compileModulationProgram,
  type CompiledModulationProgram,
} from '../core/modulation/compiled-program';
import { resolveMutedSources } from '../core/pipeline/groups';
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
  intersectSpatialRequirements,
  transformSpatialRequirement,
  unionSpatialRequirements,
} from './analysis/bounds';
import { buildCanonicalExecutionPlan } from './analysis/execution-plan';
import { buildCompiledRackPlan } from './plan/compile';
import type { CompiledRackPlan, CompiledRackStage } from './plan/types';
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
  GenerationCheckpoint,
  GenerationInvalidationScope,
  GenerationInvalidationTargetSet,
  GenerationOriginTimelineState,
  GenerationTimelineWindow,
  LedCell,
  LedTape,
} from './types';

type TimelineWindow = GenerationTimelineWindow;
type OriginTimelineState = GenerationOriginTimelineState;

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

const createGenerationCheckpoint = (
  state: MutableGenerationState,
): GenerationCheckpoint => ({
  tape: cloneTape(finalizeTape(state.tape)),
  timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
});

const createEmptyGenerationCheckpoint = (): GenerationCheckpoint => ({
  tape: createEmptyTape(),
  timelineStateByOriginId: new Map<string, OriginTimelineState>(),
});

const createGenerationStateFromCheckpoint = (
  checkpoint: GenerationCheckpoint,
): MutableGenerationState => ({
  tape: cloneTape(checkpoint.tape),
  timelineStateByOriginId: cloneTimelineStateByOriginId(checkpoint.timelineStateByOriginId),
});

const cloneCheckpointsByStageId = (
  checkpointsByStageId: ReadonlyMap<string, GenerationCheckpoint>,
): Map<string, GenerationCheckpoint> => new Map(checkpointsByStageId);

const isTargetSetEmpty = (
  targetSet: GenerationInvalidationTargetSet,
): boolean => targetSet !== 'all' && targetSet.size === 0;

const cloneTargetSet = (
  targetSet: GenerationInvalidationTargetSet,
): GenerationInvalidationTargetSet => targetSet === 'all' ? 'all' : new Set(targetSet);

const unionTargetSets = (
  left: GenerationInvalidationTargetSet,
  right: GenerationInvalidationTargetSet,
): GenerationInvalidationTargetSet => {
  if (left === 'all' || right === 'all') {
    return 'all';
  }

  return new Set<string>([
    ...left,
    ...right,
  ]);
};

const targetSetHas = (
  targetSet: GenerationInvalidationTargetSet,
  value: string | null | undefined,
): boolean => value !== null && value !== undefined && (targetSet === 'all' || targetSet.has(value));

const isSameBeatRange = (
  left: BeatRange,
  right: BeatRange,
): boolean => left.start === right.start && left.end === right.end;

const isSameSpatialRequirement = (
  left: SpatialRequirement,
  right: SpatialRequirement,
): boolean => {
  if (left === right) {
    return true;
  }

  if (typeof left === 'string' || typeof right === 'string') {
    return false;
  }

  return left.minX === right.minX
    && left.maxX === right.maxX
    && left.minY === right.minY
    && left.maxY === right.maxY;
};

const isSameExecutionRequest = (
  left: CanonicalExecutionRequest,
  right: CanonicalExecutionRequest,
): boolean => isSameSpatialRequirement(left.outputBounds, right.outputBounds)
  && isSameBeatRange(left.timeDomain, right.timeDomain);

const isSameFrameWindowRequirement = (
  left: BeatRange | 'all' | 'none',
  right: BeatRange | 'all' | 'none',
): boolean => {
  if (left === right) {
    return true;
  }

  if (typeof left === 'string' || typeof right === 'string') {
    return false;
  }

  return isSameBeatRange(left, right);
};

const unionFrameWindowRequirement = (
  left: BeatRange | 'all' | 'none',
  right: BeatRange | 'all' | 'none',
): BeatRange | 'all' | 'none' => {
  if (left === 'all' || right === 'all') {
    return 'all';
  }

  if (left === 'none') {
    return right;
  }

  if (right === 'none') {
    return left;
  }

  return {
    start: Math.min(left.start, right.start),
    end: Math.max(left.end, right.end),
  };
};

const intersectFrameWindowRequirement = (
  left: BeatRange | 'all' | 'none',
  right: BeatRange | 'all' | 'none',
): BeatRange | 'all' | 'none' => {
  if (left === 'none' || right === 'none') {
    return 'none';
  }

  if (left === 'all') {
    return right;
  }

  if (right === 'all') {
    return left;
  }

  const start = Math.max(left.start, right.start);
  const end = Math.max(start, Math.min(left.end, right.end));
  if (end <= start) {
    return 'none';
  }

  return { start, end };
};

const createEmptyInvalidationScope = (): GenerationInvalidationScope => ({
  affectedOriginIds: new Set<string>(),
  affectedGroupIds: new Set<string>(),
  outputBounds: 'none',
  frameWindow: 'none',
});

const createAllInvalidationScope = (): GenerationInvalidationScope => ({
  affectedOriginIds: 'all',
  affectedGroupIds: 'all',
  outputBounds: 'all',
  frameWindow: 'all',
});

const cloneInvalidationScope = (
  scope: GenerationInvalidationScope,
): GenerationInvalidationScope => ({
  affectedOriginIds: cloneTargetSet(scope.affectedOriginIds),
  affectedGroupIds: cloneTargetSet(scope.affectedGroupIds),
  outputBounds: scope.outputBounds === 'all' || scope.outputBounds === 'none'
    ? scope.outputBounds
    : {
      minX: scope.outputBounds.minX,
      maxX: scope.outputBounds.maxX,
      minY: scope.outputBounds.minY,
      maxY: scope.outputBounds.maxY,
    },
  frameWindow: scope.frameWindow === 'all' || scope.frameWindow === 'none'
    ? scope.frameWindow
    : {
      start: scope.frameWindow.start,
      end: scope.frameWindow.end,
    },
});

const intersectInvalidationScopeWithExecutionPlan = (
  scope: GenerationInvalidationScope,
  executionPlan: OperatorExecutionPlan,
): GenerationInvalidationScope => ({
  affectedOriginIds: cloneTargetSet(scope.affectedOriginIds),
  affectedGroupIds: cloneTargetSet(scope.affectedGroupIds),
  outputBounds: intersectSpatialRequirements(scope.outputBounds, executionPlan.requiredOutputBounds),
  frameWindow: intersectFrameWindowRequirement(scope.frameWindow, executionPlan.requiredFrameWindow),
});

const isInvalidationScopeEmpty = (
  scope: GenerationInvalidationScope,
): boolean => (isTargetSetEmpty(scope.affectedOriginIds)
  && isTargetSetEmpty(scope.affectedGroupIds))
  || scope.outputBounds === 'none'
  || scope.frameWindow === 'none';

const doesFrameIndexMatchInvalidationScope = (
  scope: GenerationInvalidationScope,
  frameIndex: number,
  tape: LedTape,
): boolean => isFrameWithinWindow(
  frameIndex,
  resolveFrameWindow(scope.frameWindow, tape.sampleStepBeats, tape.frames.length),
);

const doesCellMatchInvalidationTargets = (
  cell: LedCell,
  scope: GenerationInvalidationScope,
): boolean => (
  targetSetHas(scope.affectedOriginIds, cell.originId)
  || targetSetHas(scope.affectedGroupIds, cell.originGroupId)
  || (scope.affectedOriginIds === 'all' && scope.affectedGroupIds === 'all')
);

const collectOriginIdsFromTape = (
  tape: LedTape,
  predicate: (cell: LedCell, frameIndex: number) => boolean,
): Set<string> => {
  const originIds = new Set<string>();
  for (let frameIndex = 0; frameIndex < tape.frames.length; frameIndex += 1) {
    for (const cell of tape.frames[frameIndex].cells) {
      if (predicate(cell, frameIndex)) {
        originIds.add(cell.originId);
      }
    }
  }
  return originIds;
};

const createFilteredTape = (
  tape: LedTape,
  predicate: (cell: LedCell, frameIndex: number) => boolean,
): LedTape => {
  const nextTape = createEmptyTape(tape.sampleStepBeats, tape.timeDomainEndBeat);
  nextTape.nextWriteId = tape.nextWriteId;
  ensureTapeFrameCount(nextTape, tape.timeDomainEndBeat);

  for (let frameIndex = 0; frameIndex < tape.frames.length; frameIndex += 1) {
    for (const cell of tape.frames[frameIndex].cells) {
      if (predicate(cell, frameIndex)) {
        nextTape.frames[frameIndex].cells.push({ ...cell });
      }
    }
  }

  return finalizeTape(nextTape);
};

const createFilteredGenerationState = (
  state: MutableGenerationState,
  predicate: (cell: LedCell, frameIndex: number) => boolean,
): MutableGenerationState => ({
  tape: createFilteredTape(state.tape, predicate),
  timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
});

const renumberTapeWriteIds = (
  tape: LedTape,
): void => {
  let nextWriteId = 1;

  for (const frame of tape.frames) {
    for (const cell of frame.cells) {
      cell.writeId = nextWriteId;
      nextWriteId += 1;
    }
  }

  tape.nextWriteId = nextWriteId;
};

const isSameOperatorExecutionPlan = (
  left: OperatorExecutionPlan,
  right: OperatorExecutionPlan,
): boolean => isSameSpatialRequirement(left.requiredOutputBounds, right.requiredOutputBounds)
  && isSameSpatialRequirement(left.requiredInputRoi, right.requiredInputRoi)
  && isSameSpatialRequirement(left.requiredSourceRoi, right.requiredSourceRoi)
  && isSameFrameWindowRequirement(left.requiredFrameWindow, right.requiredFrameWindow)
  && isSameFrameWindowRequirement(left.requiredSourceFrameWindow, right.requiredSourceFrameWindow);

const findDirtyStageIndex = (
  previousPlan: CompiledRackPlan,
  nextPlan: CompiledRackPlan,
  previousExecutionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>,
  nextExecutionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>,
): number => {
  const sharedStageCount = Math.min(previousPlan.stages.length, nextPlan.stages.length);
  for (let stageIndex = 0; stageIndex < sharedStageCount; stageIndex += 1) {
    const previousStage = previousPlan.stages[stageIndex];
    const nextStage = nextPlan.stages[stageIndex];
    if (previousStage.reuseSignature !== nextStage.reuseSignature) {
      return stageIndex;
    }

    const previousStageExecutionPlan = resolveDeviceExecutionPlan(
      previousExecutionPlanByDeviceId,
      previousStage.deviceId,
    );
    const nextStageExecutionPlan = resolveDeviceExecutionPlan(
      nextExecutionPlanByDeviceId,
      nextStage.deviceId,
    );
    if (!isSameOperatorExecutionPlan(previousStageExecutionPlan, nextStageExecutionPlan)) {
      return stageIndex;
    }
  }

  return sharedStageCount;
};

const createTargetSet = (
  values: ReadonlyArray<string | null | undefined>,
): GenerationInvalidationTargetSet => {
  const next = new Set<string>();
  for (const value of values) {
    const normalized = normalizeOptionalId(value);
    if (normalized) {
      next.add(normalized);
    }
  }
  return next;
};

const isGeneratorStage = (
  stage: CompiledRackStage,
): boolean => stage.deviceKind === 'waterdrop'
  || stage.deviceKind === 'scanner'
  || stage.deviceKind === 'spiral'
  || stage.deviceKind === 'path';

const isSpatialTransformStage = (
  stage: CompiledRackStage,
): boolean => stage.deviceKind === 'translate'
  || stage.deviceKind === 'rotate'
  || stage.deviceKind === 'scale'
  || stage.deviceKind === 'mirror';

const doesStageUseFullHistoryFallback = (
  stage: CompiledRackStage,
): boolean => stage.deviceKind === 'color'
  || stage.deviceKind === 'reverse'
  || stage.deviceKind === 'timewarp';

const createDirtyStageInvalidationScope = (
  previousStage: CompiledRackStage | undefined,
  nextStage: CompiledRackStage | undefined,
  previousStageExecutionPlan: OperatorExecutionPlan | undefined,
  nextStageExecutionPlan: OperatorExecutionPlan | undefined,
  modulationChanged: boolean,
): GenerationInvalidationScope => {
  if (
    modulationChanged
    || !previousStage
    || !nextStage
    || previousStage.deviceKind !== nextStage.deviceKind
  ) {
    return createAllInvalidationScope();
  }

  const previousGroupId = normalizeOptionalId(previousStage.groupId);
  const nextGroupId = normalizeOptionalId(nextStage.groupId);
  const outputBounds = unionSpatialRequirements(
    previousStageExecutionPlan?.requiredOutputBounds ?? 'all',
    nextStageExecutionPlan?.requiredOutputBounds ?? 'all',
  );
  const frameWindow = unionFrameWindowRequirement(
    previousStageExecutionPlan?.requiredFrameWindow ?? 'all',
    nextStageExecutionPlan?.requiredFrameWindow ?? 'all',
  );

  if (isGeneratorStage(nextStage)) {
    return {
      affectedOriginIds: createTargetSet([previousStage.deviceId, nextStage.deviceId]),
      affectedGroupIds: createTargetSet([previousGroupId, nextGroupId]),
      outputBounds,
      frameWindow,
    };
  }

  if (nextGroupId !== null) {
    return {
      affectedOriginIds: 'all',
      affectedGroupIds: createTargetSet([previousGroupId, nextGroupId]),
      outputBounds,
      frameWindow,
    };
  }

  return createAllInvalidationScope();
};

const doesMaskSourceIntersectScope = (
  effect: MaskEffectNode,
  scope: GenerationInvalidationScope,
): boolean => {
  if (effect.params.sourceKind === 'tiles') {
    return false;
  }

  const sourceId = normalizeOptionalId(effect.params.sourceId);
  if (!sourceId) {
    return false;
  }

  return effect.params.sourceKind === 'group'
    ? targetSetHas(scope.affectedGroupIds, sourceId)
    : targetSetHas(scope.affectedOriginIds, sourceId);
};

const doesStageAffectCurrentScope = (
  stage: CompiledRackStage,
  scope: GenerationInvalidationScope,
): boolean => {
  if (isInvalidationScopeEmpty(scope)) {
    return false;
  }

  if (isGeneratorStage(stage)) {
    return scope.affectedOriginIds === 'all'
      || scope.affectedGroupIds === 'all'
      || targetSetHas(scope.affectedOriginIds, stage.deviceId)
      || targetSetHas(scope.affectedGroupIds, stage.groupId);
  }

  if (stage.deviceKind === 'mask') {
    const effect = stage.device as MaskEffectNode;
    return stage.groupId === null
      || targetSetHas(scope.affectedGroupIds, stage.groupId)
      || doesMaskSourceIntersectScope(effect, scope);
  }

  if (stage.groupId !== null) {
    return scope.affectedGroupIds === 'all'
      || targetSetHas(scope.affectedGroupIds, stage.groupId);
  }

  return true;
};

const resolveStageOutputScope = (
  stage: CompiledRackStage,
  executionPlan: OperatorExecutionPlan,
  scope: GenerationInvalidationScope,
): GenerationInvalidationScope => {
  if (isInvalidationScopeEmpty(scope)) {
    return createEmptyInvalidationScope();
  }

  const intersectedScope = intersectInvalidationScopeWithExecutionPlan(scope, executionPlan);
  if (isInvalidationScopeEmpty(intersectedScope)) {
    return intersectedScope;
  }

  if (!doesStageAffectCurrentScope(stage, scope)) {
    return cloneInvalidationScope(intersectedScope);
  }

  if (isGeneratorStage(stage)) {
    return {
      affectedOriginIds: createTargetSet([stage.deviceId]),
      affectedGroupIds: createTargetSet([stage.groupId]),
      outputBounds: executionPlan.requiredOutputBounds,
      frameWindow: executionPlan.requiredFrameWindow,
    };
  }

  if (stage.deviceKind === 'mask') {
    const effect = stage.device as MaskEffectNode;
    if (doesMaskSourceIntersectScope(effect, scope)) {
      return {
        affectedOriginIds: 'all',
        affectedGroupIds: stage.groupId === null ? 'all' : createTargetSet([stage.groupId]),
        outputBounds: executionPlan.requiredOutputBounds,
        frameWindow: executionPlan.requiredFrameWindow,
      };
    }
  }

  if (stage.groupId !== null) {
    return {
      affectedOriginIds: cloneTargetSet(scope.affectedOriginIds),
      affectedGroupIds: createTargetSet([stage.groupId]),
      outputBounds: intersectedScope.outputBounds,
      frameWindow: doesStageUseFullHistoryFallback(stage) ? executionPlan.requiredFrameWindow : intersectedScope.frameWindow,
    };
  }

  return {
    affectedOriginIds: cloneTargetSet(intersectedScope.affectedOriginIds),
    affectedGroupIds: cloneTargetSet(intersectedScope.affectedGroupIds),
    outputBounds: intersectedScope.outputBounds,
    frameWindow: doesStageUseFullHistoryFallback(stage) ? executionPlan.requiredFrameWindow : intersectedScope.frameWindow,
  };
};

const createScopedExecutionPlan = (
  stage: CompiledRackStage,
  executionPlan: OperatorExecutionPlan,
  scope: GenerationInvalidationScope,
): OperatorExecutionPlan => {
  const narrowedFrameWindow = doesStageUseFullHistoryFallback(stage)
    ? executionPlan.requiredFrameWindow
    : intersectFrameWindowRequirement(executionPlan.requiredFrameWindow, scope.frameWindow);

  return {
    requiredOutputBounds: intersectSpatialRequirements(executionPlan.requiredOutputBounds, scope.outputBounds),
    requiredInputRoi: executionPlan.requiredInputRoi,
    requiredSourceRoi: stage.deviceKind === 'mask'
      ? intersectSpatialRequirements(executionPlan.requiredSourceRoi, scope.outputBounds)
      : executionPlan.requiredSourceRoi,
    requiredFrameWindow: narrowedFrameWindow === 'none'
      ? executionPlan.requiredFrameWindow
      : narrowedFrameWindow,
    requiredSourceFrameWindow: stage.deviceKind === 'mask'
      ? intersectFrameWindowRequirement(executionPlan.requiredSourceFrameWindow, scope.frameWindow)
      : executionPlan.requiredSourceFrameWindow,
  };
};

const buildStageSlicePredicate = (
  stage: CompiledRackStage,
  scope: GenerationInvalidationScope,
  tape: LedTape,
): ((cell: LedCell, frameIndex: number) => boolean) => {
  if (stage.deviceKind === 'mask') {
    const targetGroupId = stage.groupId;
    return (cell, frameIndex) => {
      if (!doesFrameIndexMatchInvalidationScope(scope, frameIndex, tape)) {
        return false;
      }
      if (!isCellWithinExecutionBounds(cell.x, cell.y, scope.outputBounds)) {
        return false;
      }
      if (targetGroupId !== null && cell.originGroupId !== targetGroupId) {
        return false;
      }
      return targetGroupId !== null
        ? cell.originGroupId === targetGroupId
        : doesCellMatchInvalidationTargets(cell, scope);
    };
  }

  if (isGeneratorStage(stage)) {
    return (cell, frameIndex) => doesFrameIndexMatchInvalidationScope(scope, frameIndex, tape)
      && isCellWithinExecutionBounds(cell.x, cell.y, scope.outputBounds)
      && targetSetHas(scope.affectedOriginIds, cell.originId);
  }

  return (cell, frameIndex) => {
    if (!doesFrameIndexMatchInvalidationScope(scope, frameIndex, tape)) {
      return false;
    }
    if (!isCellWithinExecutionBounds(cell.x, cell.y, scope.outputBounds)) {
      return false;
    }
    if (stage.groupId !== null) {
      return cell.originGroupId === stage.groupId
        && (scope.affectedOriginIds === 'all' || targetSetHas(scope.affectedOriginIds, cell.originId) || targetSetHas(scope.affectedGroupIds, cell.originGroupId));
    }
    return doesCellMatchInvalidationTargets(cell, scope);
  };
};

const buildStageScopedInputState = (
  inputState: MutableGenerationState,
  stage: CompiledRackStage,
  executionPlan: OperatorExecutionPlan,
  scope: GenerationInvalidationScope,
): MutableGenerationState => {
  if (isGeneratorStage(stage)) {
    return {
      tape: createEmptyTape(inputState.tape.sampleStepBeats, inputState.tape.timeDomainEndBeat),
      timelineStateByOriginId: cloneTimelineStateByOriginId(inputState.timelineStateByOriginId),
    };
  }

  if (stage.deviceKind === 'mask') {
    const effect = stage.device as MaskEffectNode;
    return createFilteredGenerationState(inputState, (cell, frameIndex) => {
      const isTargetCell = stage.groupId === null || cell.originGroupId === stage.groupId;
      if (isTargetCell) {
        return doesFrameIndexMatchInvalidationScope(scope, frameIndex, inputState.tape)
          && isCellWithinExecutionBounds(cell.x, cell.y, executionPlan.requiredInputRoi);
      }

      if (effect.params.sourceKind === 'tiles') {
        return false;
      }

      const sourceId = normalizeOptionalId(effect.params.sourceId);
      if (!sourceId) {
        return false;
      }

      const isSourceCell = effect.params.sourceKind === 'group'
        ? cell.originGroupId === sourceId
        : cell.originId === sourceId;
      if (!isSourceCell) {
        return false;
      }

      const sourceFrameWindow = resolveFrameWindow(
        executionPlan.requiredSourceFrameWindow,
        inputState.tape.sampleStepBeats,
        inputState.tape.frames.length,
      );
      return isFrameWithinWindow(frameIndex, sourceFrameWindow)
        && isCellWithinExecutionBounds(cell.x, cell.y, executionPlan.requiredSourceRoi);
    });
  }

  return createFilteredGenerationState(inputState, (cell) => (
    (stage.groupId === null || cell.originGroupId === stage.groupId)
    && (scope.affectedOriginIds === 'all' || targetSetHas(scope.affectedOriginIds, cell.originId) || targetSetHas(scope.affectedGroupIds, cell.originGroupId))
  ));
};

const mergeStageOutputState = (
  inputState: MutableGenerationState,
  previousOutputCheckpoint: GenerationCheckpoint,
  replacementState: MutableGenerationState,
  stage: CompiledRackStage,
  scope: GenerationInvalidationScope,
): MutableGenerationState => {
  const previousOutputState = createGenerationStateFromCheckpoint(previousOutputCheckpoint);
  const slicePredicate = buildStageSlicePredicate(stage, scope, previousOutputState.tape);
  const mergedTape = createEmptyTape(
    previousOutputState.tape.sampleStepBeats,
    Math.max(previousOutputState.tape.timeDomainEndBeat, replacementState.tape.timeDomainEndBeat),
  );
  ensureTapeFrameCount(mergedTape, Math.max(previousOutputState.tape.timeDomainEndBeat, replacementState.tape.timeDomainEndBeat));

  for (let frameIndex = 0; frameIndex < previousOutputState.tape.frames.length; frameIndex += 1) {
    for (const cell of previousOutputState.tape.frames[frameIndex].cells) {
      if (!slicePredicate(cell, frameIndex)) {
        mergedTape.frames[frameIndex].cells.push({ ...cell });
      }
    }
  }

  for (let frameIndex = 0; frameIndex < replacementState.tape.frames.length; frameIndex += 1) {
    ensureTapeFrameCount(mergedTape, (frameIndex + 1) * mergedTape.sampleStepBeats);
    for (const cell of replacementState.tape.frames[frameIndex].cells) {
      if (slicePredicate(cell, frameIndex)) {
        mergedTape.frames[frameIndex].cells.push({ ...cell });
      }
    }
  }

  renumberTapeWriteIds(mergedTape);

  const finalizedTape = finalizeTape(mergedTape);
  const nextTimelineStateByOriginId = cloneTimelineStateByOriginId(previousOutputState.timelineStateByOriginId);
  const affectedOriginIds = unionTargetSets(
    unionTargetSets(
      collectOriginIdsFromTape(previousOutputState.tape, slicePredicate),
      collectOriginIdsFromTape(replacementState.tape, slicePredicate),
    ),
    scope.affectedOriginIds,
  );
  const occupiedWindowByOriginId = buildOccupiedWindowByOriginId(finalizedTape);

  if (affectedOriginIds === 'all') {
    for (const originId of new Set<string>([
      ...nextTimelineStateByOriginId.keys(),
      ...occupiedWindowByOriginId.keys(),
    ])) {
      const replacementTimelineState = replacementState.timelineStateByOriginId.get(originId);
      const inputTimelineState = inputState.timelineStateByOriginId.get(originId);
      const previousTimelineState = previousOutputState.timelineStateByOriginId.get(originId);
      const authored = replacementTimelineState?.authored
        ?? inputTimelineState?.authored
        ?? previousTimelineState?.authored;
      const window = occupiedWindowByOriginId.get(originId)
        ?? replacementTimelineState?.window
        ?? inputTimelineState?.window
        ?? previousTimelineState?.window;
      if (!window || authored === undefined) {
        nextTimelineStateByOriginId.delete(originId);
        continue;
      }
      nextTimelineStateByOriginId.set(originId, {
        authored,
        window: {
          start: window.start,
          end: window.end,
        },
      });
    }
  } else {
    for (const originId of affectedOriginIds) {
      const replacementTimelineState = replacementState.timelineStateByOriginId.get(originId);
      const inputTimelineState = inputState.timelineStateByOriginId.get(originId);
      const previousTimelineState = previousOutputState.timelineStateByOriginId.get(originId);
      const authored = replacementTimelineState?.authored
        ?? inputTimelineState?.authored
        ?? previousTimelineState?.authored;
      const window = occupiedWindowByOriginId.get(originId)
        ?? replacementTimelineState?.window
        ?? inputTimelineState?.window
        ?? previousTimelineState?.window;
      if (!window || authored === undefined) {
        nextTimelineStateByOriginId.delete(originId);
        continue;
      }
      nextTimelineStateByOriginId.set(originId, {
        authored,
        window: {
          start: window.start,
          end: window.end,
        },
      });
    }
  }

  return {
    tape: finalizedTape,
    timelineStateByOriginId: nextTimelineStateByOriginId,
  };
};

const propagateInvalidationScopeThroughStage = (
  stage: CompiledRackStage,
  scope: GenerationInvalidationScope,
): GenerationInvalidationScope => {
  if (isInvalidationScopeEmpty(scope)) {
    return scope;
  }

  if (stage.deviceKind === 'mask') {
    return {
      affectedOriginIds: stage.groupId === null ? 'all' : 'all',
      affectedGroupIds: stage.groupId === null ? 'all' : createTargetSet([stage.groupId]),
      outputBounds: scope.outputBounds,
      frameWindow: scope.frameWindow,
    };
  }

  if (stage.deviceKind === 'symmetry') {
    return {
      affectedOriginIds: cloneTargetSet(scope.affectedOriginIds),
      affectedGroupIds: cloneTargetSet(scope.affectedGroupIds),
      outputBounds: 'all',
      frameWindow: scope.frameWindow,
    };
  }

  if (isSpatialTransformStage(stage)) {
    const transform = resolveEffectTransform(stage.device as GeneratorEffectNode);
    return {
      affectedOriginIds: cloneTargetSet(scope.affectedOriginIds),
      affectedGroupIds: cloneTargetSet(scope.affectedGroupIds),
      outputBounds: transform ? transformSpatialRequirement(scope.outputBounds, transform) : 'all',
      frameWindow: scope.frameWindow,
    };
  }

  if (stage.deviceKind === 'trim' || stage.deviceKind === 'stretch') {
    return {
      affectedOriginIds: cloneTargetSet(scope.affectedOriginIds),
      affectedGroupIds: cloneTargetSet(scope.affectedGroupIds),
      outputBounds: scope.outputBounds,
      frameWindow: scope.frameWindow === 'none' ? 'none' : 'all',
    };
  }

  if (doesStageUseFullHistoryFallback(stage)) {
    return {
      affectedOriginIds: cloneTargetSet(scope.affectedOriginIds),
      affectedGroupIds: cloneTargetSet(scope.affectedGroupIds),
      outputBounds: scope.outputBounds,
      frameWindow: 'all',
    };
  }

  return cloneInvalidationScope(scope);
};

const applyEffectDevice = (
  state: MutableGenerationState,
  chain: GeneratorChain,
  stage: CompiledRackStage,
  surfaceAdapter: CanonicalSurfaceAdapter,
  spatialAdapter: CanonicalSpatialAdapter,
  modulationContext: ModulationContext,
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>,
): MutableGenerationState => {
  const device = stage.device as GeneratorEffectNode;
  const deviceIndex = stage.stageIndex;
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
  stage: CompiledRackStage,
  modulationContext: ModulationContext,
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>,
): MutableGenerationState => {
  const device = stage.device as GeneratorNode;
  const deviceIndex = stage.stageIndex;
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

const applyCompiledRackStage = (
  state: MutableGenerationState,
  compiledPlan: CompiledRackPlan,
  stage: CompiledRackStage,
  surfaceAdapter: CanonicalSurfaceAdapter,
  spatialAdapter: CanonicalSpatialAdapter,
  modulationContext: ModulationContext,
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>,
): MutableGenerationState => isGeneratorStage(stage)
  ? applyGeneratorDevice(
      state,
      stage,
      modulationContext,
      executionPlanByDeviceId,
    )
  : applyEffectDevice(
      state,
      compiledPlan.baseChain,
      stage,
      surfaceAdapter,
      spatialAdapter,
      modulationContext,
      executionPlanByDeviceId,
    );

const executeCompiledRackPlan = (
  compiledPlan: CompiledRackPlan,
  loopLengthBeats: number,
  surfaceAdapter: CanonicalSurfaceAdapter,
  spatialAdapter: CanonicalSpatialAdapter,
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>,
): {
  state: MutableGenerationState;
  checkpointsByStageId: Map<string, GenerationCheckpoint>;
} => executeCompiledRackPlanFromStage({
  compiledPlan,
  loopLengthBeats,
  surfaceAdapter,
  spatialAdapter,
  executionPlanByDeviceId,
  startStageIndex: 0,
  initialCheckpoint: createEmptyGenerationCheckpoint(),
  reusedPrefixCheckpoints: new Map<string, GenerationCheckpoint>(),
  previousCheckpointsByStageId: new Map<string, GenerationCheckpoint>(),
  initialInvalidationScope: createAllInvalidationScope(),
});

const executeCompiledRackPlanFromStage = ({
  compiledPlan,
  loopLengthBeats,
  surfaceAdapter,
  spatialAdapter,
  executionPlanByDeviceId,
  startStageIndex,
  initialCheckpoint,
  reusedPrefixCheckpoints,
  previousCheckpointsByStageId,
  initialInvalidationScope,
}: {
  compiledPlan: CompiledRackPlan;
  loopLengthBeats: number;
  surfaceAdapter: CanonicalSurfaceAdapter;
  spatialAdapter: CanonicalSpatialAdapter;
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>;
  startStageIndex: number;
  initialCheckpoint: GenerationCheckpoint;
  reusedPrefixCheckpoints: ReadonlyMap<string, GenerationCheckpoint>;
  previousCheckpointsByStageId: ReadonlyMap<string, GenerationCheckpoint>;
  initialInvalidationScope: GenerationInvalidationScope;
}): {
  state: MutableGenerationState;
  checkpointsByStageId: Map<string, GenerationCheckpoint>;
} => {
  const modulationContext = createModulationContext(compiledPlan.baseChain, loopLengthBeats);
  let currentState = createGenerationStateFromCheckpoint(initialCheckpoint);
  const checkpointsByStageId = cloneCheckpointsByStageId(reusedPrefixCheckpoints);
  let currentScope = cloneInvalidationScope(initialInvalidationScope);

  for (let stageIndex = startStageIndex; stageIndex < compiledPlan.stages.length; stageIndex += 1) {
    const stage = compiledPlan.stages[stageIndex];
    const stageExecutionPlan = resolveDeviceExecutionPlan(executionPlanByDeviceId, stage.deviceId);
    const previousOutputCheckpoint = previousCheckpointsByStageId.get(stage.stageId);
    const stageOutputScope = resolveStageOutputScope(stage, stageExecutionPlan, currentScope);

    if (!previousOutputCheckpoint) {
      currentState = applyCompiledRackStage(
        currentState,
        compiledPlan,
        stage,
        surfaceAdapter,
        spatialAdapter,
        modulationContext,
        executionPlanByDeviceId,
      );
    } else if (!doesStageAffectCurrentScope(stage, currentScope) || isInvalidationScopeEmpty(stageOutputScope)) {
      currentState = applyCompiledRackStage(
        currentState,
        compiledPlan,
        stage,
        surfaceAdapter,
        spatialAdapter,
        modulationContext,
        executionPlanByDeviceId,
      );
    } else {
      const scopedExecutionPlan = createScopedExecutionPlan(stage, stageExecutionPlan, stageOutputScope);
      const scopedExecutionPlanByDeviceId = new Map(executionPlanByDeviceId);
      scopedExecutionPlanByDeviceId.set(stage.deviceId, scopedExecutionPlan);
      const scopedInputState = buildStageScopedInputState(
        currentState,
        stage,
        scopedExecutionPlan,
        stageOutputScope,
      );
      const replacementState = applyCompiledRackStage(
        scopedInputState,
        compiledPlan,
        stage,
        surfaceAdapter,
        spatialAdapter,
        modulationContext,
        scopedExecutionPlanByDeviceId,
      );
      currentState = mergeStageOutputState(
        currentState,
        previousOutputCheckpoint,
        replacementState,
        stage,
        stageOutputScope,
      );
    }

    checkpointsByStageId.set(stage.stageId, createGenerationCheckpoint(currentState));
    currentScope = propagateInvalidationScopeThroughStage(stage, stageOutputScope);
  }

  return {
    state: currentState,
    checkpointsByStageId,
  };
};

export const buildCanonicalFieldResult = (
  chain: GeneratorChain,
  loopLengthBeats: number,
  surfaceAdapter: CanonicalSurfaceAdapter,
  spatialAdapter: CanonicalSpatialAdapter,
  executionRequest: CanonicalExecutionRequest,
  previousResult?: CanonicalFieldResult | null,
): CanonicalFieldResult => {
  const compiledPlan = buildCompiledRackPlan(chain, loopLengthBeats);
  const executionPlan = buildCanonicalExecutionPlan(compiledPlan.baseChain, executionRequest);
  let executionResult: {
    state: MutableGenerationState;
    checkpointsByStageId: Map<string, GenerationCheckpoint>;
  };

  const canReusePreviousResult = previousResult
    && previousResult.loopLengthBeats === loopLengthBeats
    && isSameExecutionRequest(previousResult.executionPlan.finalRequest, executionPlan.finalRequest)
    && previousResult.compiledPlan.modulationSignature === compiledPlan.modulationSignature;

  if (!canReusePreviousResult) {
    executionResult = executeCompiledRackPlan(
      compiledPlan,
      loopLengthBeats,
      surfaceAdapter,
      spatialAdapter,
      executionPlan.byDeviceId,
    );
  } else {
    const dirtyStageIndex = findDirtyStageIndex(
      previousResult.compiledPlan,
      compiledPlan,
      previousResult.executionPlan.byDeviceId,
      executionPlan.byDeviceId,
    );
    const reusedPrefixCheckpoints = new Map<string, GenerationCheckpoint>();
    let reusablePrefixComplete = true;

    for (let stageIndex = 0; stageIndex < dirtyStageIndex; stageIndex += 1) {
      const previousStage = previousResult.compiledPlan.stages[stageIndex];
      const nextStage = compiledPlan.stages[stageIndex];
      const checkpoint = previousResult.checkpointsByStageId.get(previousStage.stageId);
      if (!checkpoint) {
        reusablePrefixComplete = false;
        break;
      }
      reusedPrefixCheckpoints.set(nextStage.stageId, checkpoint);
    }

    if (!reusablePrefixComplete) {
      executionResult = executeCompiledRackPlan(
        compiledPlan,
        loopLengthBeats,
        surfaceAdapter,
        spatialAdapter,
        executionPlan.byDeviceId,
      );
    } else {
      if (
        dirtyStageIndex === compiledPlan.stages.length
        && previousResult.compiledPlan.stages.length === compiledPlan.stages.length
      ) {
        return previousResult;
      }

      const initialCheckpoint = dirtyStageIndex === 0
        ? createEmptyGenerationCheckpoint()
        : reusedPrefixCheckpoints.get(compiledPlan.stages[dirtyStageIndex - 1].stageId)
          ?? createEmptyGenerationCheckpoint();
      const previousDirtyStage = previousResult.compiledPlan.stages[dirtyStageIndex];
      const nextDirtyStage = compiledPlan.stages[dirtyStageIndex];
      const previousDirtyStageExecutionPlan = previousDirtyStage
        ? resolveDeviceExecutionPlan(previousResult.executionPlan.byDeviceId, previousDirtyStage.deviceId)
        : undefined;
      const nextDirtyStageExecutionPlan = nextDirtyStage
        ? resolveDeviceExecutionPlan(executionPlan.byDeviceId, nextDirtyStage.deviceId)
        : undefined;
      const hasMaskStageInDirtySuffix = compiledPlan.stages
        .slice(dirtyStageIndex)
        .some((stage) => stage.deviceKind === 'mask');
      const canUseScopedDirtyRecompute = !!previousDirtyStage
        && !!nextDirtyStage
        && previousDirtyStage.reuseSignature !== nextDirtyStage.reuseSignature
        && !hasMaskStageInDirtySuffix;

      executionResult = executeCompiledRackPlanFromStage({
        compiledPlan,
        loopLengthBeats,
        surfaceAdapter,
        spatialAdapter,
        executionPlanByDeviceId: executionPlan.byDeviceId,
        startStageIndex: dirtyStageIndex,
        initialCheckpoint,
        reusedPrefixCheckpoints,
        previousCheckpointsByStageId: canUseScopedDirtyRecompute
          ? previousResult.checkpointsByStageId
          : new Map<string, GenerationCheckpoint>(),
        initialInvalidationScope: canUseScopedDirtyRecompute
          ? createDirtyStageInvalidationScope(
              previousDirtyStage,
              nextDirtyStage,
              previousDirtyStageExecutionPlan,
              nextDirtyStageExecutionPlan,
              false,
            )
          : createAllInvalidationScope(),
      });
    }
  }

  const tape = finalizeTape(executionResult.state.tape);
  const { mutedGroupIds, mutedGeneratorIds } = resolveMutedSources(compiledPlan.baseChain);

  return {
    loopLengthBeats,
    tape,
    sourceTimelineEndBeat: tape.timeDomainEndBeat,
    sampleStepBeats: tape.sampleStepBeats,
    mutedGroupIds,
    mutedGeneratorIds,
    analysis: compiledPlan.analysis,
    executionPlan,
    compiledPlan,
    checkpointsByStageId: executionResult.checkpointsByStageId,
  };
};
