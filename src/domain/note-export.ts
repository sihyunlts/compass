import { SAMPLES_PER_BEAT } from '../core/pipeline/constants';
import { analyzeChainOriginTimelinePolicy } from '../core/pipeline/origin-timeline-policy';
import { normalizeNotesByOriginTimelinePolicy } from '../core/pipeline/timeline-fit';
import { buildFinalOutputNotes } from './checkpoint-note-evaluator';
import {
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  type GenerateNotesInput,
  type GeneratedNotesResult,
  type RuntimeMapData,
} from './note-generation-types';
import { buildRuntimeMapData } from './runtime-map';

export const buildGeneratedNotesWithRuntimeMap = ({
  chain,
  loopLengthBeats,
  runtimeMap,
}: {
  chain: GenerateNotesInput['chain'];
  loopLengthBeats: number;
  runtimeMap: RuntimeMapData;
}): GeneratedNotesResult => {
  if (!Number.isFinite(loopLengthBeats) || loopLengthBeats <= 0) {
    return {
      notes: [],
      sourceTimelineEndBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
    };
  }

  const steps = Math.round(loopLengthBeats * SAMPLES_PER_BEAT);
  if (!Number.isFinite(steps) || steps <= 0) {
    return {
      notes: [],
      sourceTimelineEndBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
    };
  }

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
  };
};

export const buildGeneratedNotes = ({
  chain,
  loopLengthBeats,
  launchpadModel,
}: GenerateNotesInput): GeneratedNotesResult => buildGeneratedNotesWithRuntimeMap({
  chain,
  loopLengthBeats,
  runtimeMap: buildRuntimeMapData(launchpadModel),
});
