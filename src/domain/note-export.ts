import { buildGeneratedFieldResultWithRuntimeMap } from './field-result';
import type {
  GenerateNotesInput,
  GeneratedNotesResult,
  RuntimeMapData,
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
  const generated = buildGeneratedFieldResultWithRuntimeMap({
    chain,
    loopLengthBeats,
    runtimeMap,
  });

  return {
    notes: generated.notes,
    sourceTimelineEndBeat: generated.sourceTimelineEndBeat,
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
