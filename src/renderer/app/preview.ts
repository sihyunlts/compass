import { generateNotes, generatePreviewStats } from '../../domain';
import type {
  GeneratorChain,
  GeneratorPreview,
  LaunchpadModel,
} from '../../shared/types';

/** Generates preview notes/stats with the same domain pipeline used for send operations. */
export const generateRendererPreview = (
  chain: GeneratorChain,
  loopLengthBeats: number,
  launchpadModel: LaunchpadModel,
): GeneratorPreview => {
  const notes = generateNotes({
    chain,
    loopLengthBeats,
    launchpadModel,
  });
  return {
    ...generatePreviewStats(notes),
    notes,
  };
};
