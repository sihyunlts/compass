import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { buildGeneratedFieldResult } from '../domain/field-result';
import { toGeneratorPreview } from '../domain/generator-preview';
import type { GeneratorPreview } from '../shared/contracts/preview/generator-preview';
import type { LaunchpadModel } from '../shared/model';
import { resolveEvenlySpacedSampleIndices } from '../shared/even-sampling';
import { parsePresetFileText } from '../shared/presets';

export const RACK_PREVIEW_LOOP_LENGTH_BEATS = 1;
export const RACK_REGRESSION_FIXTURE_DIR = path.join(
  process.cwd(),
  'test',
  'racks',
  'regression',
);

export interface RackPreviewLoadOptions {
  loopLengthBeats?: number;
  launchpadModel?: LaunchpadModel;
}

export interface SampledRackFrame {
  frameIndex: number;
  entries: GeneratorPreview['ledFramesBySampleIndex'][number];
}

const resolvePreviewLoadOptions = (
  options: RackPreviewLoadOptions,
): Required<RackPreviewLoadOptions> => ({
  loopLengthBeats: options.loopLengthBeats ?? RACK_PREVIEW_LOOP_LENGTH_BEATS,
  launchpadModel: options.launchpadModel ?? 'mk3',
});

export const loadRackPreviewFromFile = async (
  rackPath: string,
  options: RackPreviewLoadOptions = {},
): Promise<GeneratorPreview> => {
  const resolvedOptions = resolvePreviewLoadOptions(options);
  const parsed = parsePresetFileText(await readFile(rackPath, 'utf8'), {
    fileName: rackPath,
  });
  if (!parsed.ok) {
    throw new Error(`${rackPath}: preset must parse`);
  }
  if (parsed.preset.presetType !== 'rack') {
    throw new Error(`${rackPath}: preset must be a rack`);
  }

  return toGeneratorPreview(buildGeneratedFieldResult({
    chain: parsed.preset.chain,
    loopLengthBeats: resolvedOptions.loopLengthBeats,
    launchpadModel: resolvedOptions.launchpadModel,
  }));
};

export const loadRackPreviewFromFixture = async (
  rackFileName: string,
  options: RackPreviewLoadOptions = {},
): Promise<GeneratorPreview> => loadRackPreviewFromFile(
  path.join(RACK_REGRESSION_FIXTURE_DIR, rackFileName),
  options,
);

export const sampleRackPreviewFrames = (
  preview: GeneratorPreview,
  requestedFrameCount: number,
): SampledRackFrame[] => resolveEvenlySpacedSampleIndices(
  preview.ledFramesBySampleIndex.length,
  requestedFrameCount,
).map((frameIndex) => ({
  frameIndex,
  entries: preview.ledFramesBySampleIndex[frameIndex] ?? [],
}));
