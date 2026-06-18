import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { buildGeneratedFieldResult } from '../domain/field-result';
import { toGeneratorPreview } from '../domain/generator-preview';
import type { GeneratorPreview } from '../shared/contracts/preview/generator-preview';
import type { LaunchpadModel } from '../shared/model';
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
): SampledRackFrame[] => {
  const sourceFrameCount = preview.ledFramesBySampleIndex.length;
  if (sourceFrameCount === 0) {
    return [];
  }

  const safeRequestedFrameCount = Number.isFinite(requestedFrameCount)
    ? Math.floor(requestedFrameCount)
    : sourceFrameCount;
  const frameCount = Math.max(1, Math.min(safeRequestedFrameCount, sourceFrameCount));
  if (frameCount === sourceFrameCount) {
    return preview.ledFramesBySampleIndex.map((entries, frameIndex) => ({
      frameIndex,
      entries,
    }));
  }

  return Array.from({ length: frameCount }, (_, sampleIndex) => {
    const frameIndex = frameCount === 1
      ? 0
      : Math.round((sampleIndex * (sourceFrameCount - 1)) / (frameCount - 1));
    return {
      frameIndex,
      entries: preview.ledFramesBySampleIndex[frameIndex] ?? [],
    };
  });
};
