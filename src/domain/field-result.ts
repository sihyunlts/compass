import { NOTE_SAMPLES_PER_BEAT } from '../core/pipeline/constants';
import { compileModulationProgram } from '../core/modulation/compiled-program';
import { analyzeChainOriginTimelinePolicy } from '../core/pipeline/origin-timeline-policy';
import { normalizeNotesByOriginTimelinePolicy } from '../core/pipeline/timeline-fit';
import { buildFinalOutputNotes } from './final-output-notes';
import {
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  type GenerateNotesInput,
  type RuntimeMapData,
} from './note-generation-types';
import { buildRuntimeMapData } from './runtime-map';
import { buildCanonicalFieldResult } from '../generation/engine';
import { buildLedFramesBySampleIndexFromNotes } from '../generation/raster';
import type { LedFrameVelocityEntry } from '../generation/types';
import type { ClipNoteWithOrigin } from '../devices/color/color-program';

export interface GeneratedRuntimeFieldResult {
  notes: ClipNoteWithOrigin[];
  sourceTimelineEndBeat: number;
  sampleStepBeats: number;
  ledFramesBySampleIndex: ReadonlyArray<ReadonlyArray<LedFrameVelocityEntry>>;
}

const DEFAULT_SAMPLE_STEP_BEATS = 1 / NOTE_SAMPLES_PER_BEAT;

const createEmptyFieldResult = (): GeneratedRuntimeFieldResult => ({
  notes: [],
  sourceTimelineEndBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  sampleStepBeats: DEFAULT_SAMPLE_STEP_BEATS,
  ledFramesBySampleIndex: buildLedFramesBySampleIndexFromNotes(
    [],
    NORMALIZED_SOURCE_TIMELINE_END_BEAT,
    DEFAULT_SAMPLE_STEP_BEATS,
  ),
});

const buildLegacyGeneratedFieldResultWithRuntimeMap = ({
  chain,
  loopLengthBeats,
  runtimeMap,
}: {
  chain: GenerateNotesInput['chain'];
  loopLengthBeats: number;
  runtimeMap: RuntimeMapData;
}): GeneratedRuntimeFieldResult => {
  const originTimelineAnalysis = analyzeChainOriginTimelinePolicy(chain);
  const normalized = normalizeNotesByOriginTimelinePolicy(
    buildFinalOutputNotes({
      chain,
      loopLengthBeats,
      runtimeMap,
    }),
    originTimelineAnalysis.originTimelinePolicyByGeneratorId,
  );

  return {
    notes: normalized.notes,
    sourceTimelineEndBeat: normalized.sourceTimelineEndBeat,
    sampleStepBeats: DEFAULT_SAMPLE_STEP_BEATS,
    ledFramesBySampleIndex: buildLedFramesBySampleIndexFromNotes(
      normalized.notes,
      normalized.sourceTimelineEndBeat,
      DEFAULT_SAMPLE_STEP_BEATS,
    ),
  };
};

const shouldUseLegacyFieldResult = (
  chain: GenerateNotesInput['chain'],
): boolean => compileModulationProgram(chain).routes.length > 0;

export const buildGeneratedFieldResultWithRuntimeMap = ({
  chain,
  loopLengthBeats,
  runtimeMap,
}: {
  chain: GenerateNotesInput['chain'];
  loopLengthBeats: number;
  runtimeMap: RuntimeMapData;
}): GeneratedRuntimeFieldResult => {
  if (!Number.isFinite(loopLengthBeats) || loopLengthBeats <= 0) {
    return createEmptyFieldResult();
  }

  if (shouldUseLegacyFieldResult(chain)) {
    return buildLegacyGeneratedFieldResultWithRuntimeMap({
      chain,
      loopLengthBeats,
      runtimeMap,
    });
  }

  const generated = buildCanonicalFieldResult(chain, runtimeMap);
  return {
    notes: generated.notes,
    sourceTimelineEndBeat: generated.sourceTimelineEndBeat,
    sampleStepBeats: generated.sampleStepBeats,
    ledFramesBySampleIndex: generated.ledFramesBySampleIndex,
  };
};

export const buildGeneratedFieldResult = ({
  chain,
  loopLengthBeats,
  launchpadModel,
}: GenerateNotesInput): GeneratedRuntimeFieldResult => buildGeneratedFieldResultWithRuntimeMap({
  chain,
  loopLengthBeats,
  runtimeMap: buildRuntimeMapData(launchpadModel),
});
