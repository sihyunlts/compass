import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { buildGeneratedFieldResult } from '../domain/field-result';
import { toGeneratorPreview } from '../domain/generator-preview';
import type { GeneratorPreview } from '../shared/contracts/preview/generator-preview';
import type { ClipNote } from '../shared/model';
import { parsePresetFileText } from '../shared/presets';

const REPO_ROOT = process.cwd();
const RACK_FIXTURE_DIR = path.join(REPO_ROOT, 'test', 'racks', 'regression');
const BASELINE_DIR = path.join(REPO_ROOT, 'test', 'racks', 'baselines');
const UPDATE_BASELINES = process.env.UPDATE_RACK_BASELINES === '1';
const LOOP_LENGTH_BEATS = 1;
const FRAME_BUCKET_COUNT = 32;
const FLOAT_PRECISION = 6;

interface RackSignature {
  noteCount: number;
  uniquePitchCount: number;
  sourceTimelineEndBeat: number;
  sampleStepBeats: number;
  occupiedPitches: number[];
  velocityHistogram: Record<string, number>;
  noteStartHistogram: Record<string, number>;
  noteDurationHistogram: Record<string, number>;
  firstActiveFrame: number | null;
  lastActiveFrame: number | null;
  frameBuckets: string[][];
}

const roundNumber = (
  value: number,
): number => Number(value.toFixed(FLOAT_PRECISION));

const incrementHistogram = (
  histogram: Record<string, number>,
  key: string,
): void => {
  histogram[key] = (histogram[key] ?? 0) + 1;
};

const sortRecord = (
  record: Record<string, number>,
): Record<string, number> => Object.fromEntries(
  Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
);

const assertValidNote = (
  note: ClipNote,
  rackName: string,
): void => {
  assert.equal(Number.isFinite(note.pitch), true, `${rackName}: note pitch must be finite`);
  assert.equal(Number.isFinite(note.channel), true, `${rackName}: note channel must be finite`);
  assert.equal(Number.isFinite(note.velocity), true, `${rackName}: note velocity must be finite`);
  assert.equal(Number.isFinite(note.startBeat), true, `${rackName}: note start must be finite`);
  assert.equal(Number.isFinite(note.durationBeats), true, `${rackName}: note duration must be finite`);
  assert.equal(note.durationBeats > 0, true, `${rackName}: note duration must be positive`);
  assert.equal(note.startBeat >= 0, true, `${rackName}: note start must not be negative`);
  assert.equal(
    note.startBeat + note.durationBeats <= LOOP_LENGTH_BEATS + Number.EPSILON,
    true,
    `${rackName}: note must end inside the loop`,
  );
  assert.equal(note.velocity >= 1 && note.velocity <= 127, true, `${rackName}: velocity must be MIDI-safe`);
};

const toFrameBuckets = (
  preview: GeneratorPreview,
): string[][] => {
  const buckets = Array.from<string[], string[]>({ length: FRAME_BUCKET_COUNT }, () => []);
  const frames = preview.ledFramesBySampleIndex;
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const bucketIndex = Math.min(
      Math.floor((frameIndex * FRAME_BUCKET_COUNT) / Math.max(frames.length, 1)),
      FRAME_BUCKET_COUNT - 1,
    );
    const entries = frames[frameIndex]
      .map(([pitch, velocity]) => `${pitch}:${velocity}`)
      .sort((left, right) => left.localeCompare(right));
    buckets[bucketIndex].push(...entries);
  }

  return buckets.map((bucket) => Array.from(new Set(bucket)).sort((left, right) => left.localeCompare(right)));
};

const buildRackSignature = (
  preview: GeneratorPreview,
  rackName: string,
): RackSignature => {
  assert.equal(preview.notes.length > 0, true, `${rackName}: rack must generate notes`);
  assert.equal(
    Number.isFinite(preview.sourceTimelineEndBeat) && preview.sourceTimelineEndBeat > 0,
    true,
    `${rackName}: source timeline length must be positive`,
  );
  assert.equal(
    Number.isFinite(preview.sampleStepBeats) && preview.sampleStepBeats > 0,
    true,
    `${rackName}: sample step must be positive`,
  );

  const occupiedPitches = new Set<number>();
  const velocityHistogram: Record<string, number> = {};
  const noteStartHistogram: Record<string, number> = {};
  const noteDurationHistogram: Record<string, number> = {};

  for (const note of preview.notes) {
    assertValidNote(note, rackName);
    occupiedPitches.add(note.pitch);
    incrementHistogram(velocityHistogram, String(note.velocity));
    incrementHistogram(noteStartHistogram, String(roundNumber(note.startBeat)));
    incrementHistogram(noteDurationHistogram, String(roundNumber(note.durationBeats)));
  }

  let firstActiveFrame: number | null = null;
  let lastActiveFrame: number | null = null;
  for (let frameIndex = 0; frameIndex < preview.ledFramesBySampleIndex.length; frameIndex += 1) {
    if (preview.ledFramesBySampleIndex[frameIndex].length === 0) {
      continue;
    }

    firstActiveFrame ??= frameIndex;
    lastActiveFrame = frameIndex;
  }

  return {
    noteCount: preview.notes.length,
    uniquePitchCount: preview.uniquePitchCount,
    sourceTimelineEndBeat: roundNumber(preview.sourceTimelineEndBeat),
    sampleStepBeats: roundNumber(preview.sampleStepBeats),
    occupiedPitches: Array.from(occupiedPitches).sort((left, right) => left - right),
    velocityHistogram: sortRecord(velocityHistogram),
    noteStartHistogram: sortRecord(noteStartHistogram),
    noteDurationHistogram: sortRecord(noteDurationHistogram),
    firstActiveFrame,
    lastActiveFrame,
    frameBuckets: toFrameBuckets(preview),
  };
};

const loadRackPreview = async (
  rackFileName: string,
): Promise<GeneratorPreview> => {
  const rackPath = path.join(RACK_FIXTURE_DIR, rackFileName);
  const parsed = parsePresetFileText(await readFile(rackPath, 'utf8'), {
    fileName: rackPath,
  });
  assert.equal(parsed.ok, true, `${rackFileName}: preset must parse`);
  assert.equal(parsed.preset.presetType, 'rack', `${rackFileName}: preset must be a rack`);

  return toGeneratorPreview(buildGeneratedFieldResult({
    chain: parsed.preset.chain,
    loopLengthBeats: LOOP_LENGTH_BEATS,
    launchpadModel: 'mk3',
  }));
};

const readBaseline = async (
  baselinePath: string,
): Promise<RackSignature> => JSON.parse(await readFile(baselinePath, 'utf8')) as RackSignature;

const writeBaseline = async (
  baselinePath: string,
  signature: RackSignature,
): Promise<void> => {
  await mkdir(path.dirname(baselinePath), { recursive: true });
  await writeFile(baselinePath, `${JSON.stringify(signature, null, 2)}\n`, 'utf8');
};

test('rack regression fixtures match their compact generation baselines', async () => {
  const rackFileNames = (await readdir(RACK_FIXTURE_DIR))
    .filter((name) => name.endsWith('.compassrack'))
    .sort((left, right) => left.localeCompare(right));
  const expectedBaselineNames = rackFileNames.map((rackFileName) => rackFileName.replace(/\.compassrack$/, '.json'));

  assert.equal(rackFileNames.length > 0, true, 'expected at least one rack fixture');

  if (!UPDATE_BASELINES) {
    const baselineNames = (await readdir(BASELINE_DIR))
      .filter((name) => name.endsWith('.json'))
      .sort((left, right) => left.localeCompare(right));
    assert.deepEqual(baselineNames, expectedBaselineNames, 'rack baselines must match rack fixtures');
  }

  for (const rackFileName of rackFileNames) {
    const preview = await loadRackPreview(rackFileName);
    const signature = buildRackSignature(preview, rackFileName);
    const baselinePath = path.join(BASELINE_DIR, rackFileName.replace(/\.compassrack$/, '.json'));

    if (UPDATE_BASELINES) {
      await writeBaseline(baselinePath, signature);
      continue;
    }

    assert.equal(existsSync(baselinePath), true, `${rackFileName}: missing baseline`);
    assert.deepEqual(signature, await readBaseline(baselinePath), `${rackFileName}: baseline changed`);
  }
});

test('color and rotate keep equivalent output regardless of order', async () => {
  const colorThenRotate = buildRackSignature(
    await loadRackPreview('test_order_color_rotate_color_then_rotate.compassrack'),
    'test_order_color_rotate_color_then_rotate.compassrack',
  );
  const rotateThenColor = buildRackSignature(
    await loadRackPreview('test_order_color_rotate_rotate_then_color.compassrack'),
    'test_order_color_rotate_rotate_then_color.compassrack',
  );

  assert.deepEqual(colorThenRotate, rotateThenColor);
});

test('disabled group output does not leak into generated notes', async () => {
  const preview = await loadRackPreview('test_disabled_group_bypass.compassrack');
  assert.equal(
    preview.notes.some((note) => note.velocity === 120),
    false,
    'muted group velocity should not be emitted',
  );
});
