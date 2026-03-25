import assert from 'node:assert/strict';
import test from 'node:test';

import { generatePreviewNotesData } from '../src/domain';
import { buildGeneratedNotesWithRuntimeMap } from '../src/domain/note-export';
import { getLaunchpadRuntimeMap } from '../src/domain/launchpad-model';
import { resolveActiveTileIdsAtBeat } from '../src/domain/mask-note-filter';
import { buildRuntimeMapDataFromButtonIndex } from '../src/domain/runtime-map';
import { toPreviewFrameBeat } from '../src/renderer/features/preview/frame-index';
import {
  createPreviewResultCache,
} from '../src/renderer/features/preview/result-cache';
import type { ClipNote, GeneratorChain } from '../src/shared/model';

const LOOP_LENGTH_BEATS = 4;
const LAUNCHPAD_MODEL = 'mk3' as const;

const createScannerGenerator = (
  id = 'generator',
  groupId: string | null = null,
  angleDeg = 0,
): GeneratorChain['devices'][number] => ({
  id,
  kind: 'scanner',
  enabled: true,
  groupId,
  params: { angleDeg },
});

const createColorDevice = (
  id = 'color',
  velocities: number[] = [20, 100],
): GeneratorChain['devices'][number] => ({
  id,
  kind: 'color',
  enabled: true,
  groupId: null,
  params: {
    velocities,
    noteLengthPercent: 80,
    gapPercent: 20,
  },
});

const createReverseDevice = (
  id = 'reverse',
  groupId: string | null = null,
): GeneratorChain['devices'][number] => ({
  id,
  kind: 'reverse',
  enabled: true,
  groupId,
});

const createTrimDevice = (
  id = 'trim',
  groupId: string | null = null,
): GeneratorChain['devices'][number] => ({
  id,
  kind: 'trim',
  enabled: true,
  groupId,
  params: {
    start: 0.2,
    end: 0.8,
  },
});

const createStretchDevice = (
  id = 'stretch',
  groupId: string | null = null,
): GeneratorChain['devices'][number] => ({
  id,
  kind: 'stretch',
  enabled: true,
  groupId,
  params: {
    start: 0.2,
    end: 0.8,
  },
});

const createTimeWarpDevice = (): GeneratorChain['devices'][number] => ({
  id: 'timewarp',
  kind: 'timewarp',
  enabled: true,
  groupId: null,
  params: {
    curve: {
      divisions: 16,
      nodes: [
        { id: 'start', t: 0, v: 0 },
        { id: 'mid', t: 0.5, v: 1 },
        { id: 'end', t: 1, v: 0.25 },
      ],
    },
  },
});

const createDebug3TimeWarpDevice = (
  id = 'timewarp',
): GeneratorChain['devices'][number] => ({
  id,
  kind: 'timewarp',
  enabled: true,
  groupId: null,
  params: {
    curve: {
      divisions: 16,
      nodes: [
        { id: 'timewarp-node-start', t: 0, v: 0, nextCurveBend: 0.094912 },
        { id: 'curve-node-fqbqn4-mn5vepl5', t: 0.375, v: 0.801514 },
        { id: 'timewarp-node-end', t: 1, v: 1 },
      ],
    },
  },
});

const createIdentityTimeWarpDevice = (
  id = 'timewarp',
): GeneratorChain['devices'][number] => ({
  id,
  kind: 'timewarp',
  enabled: true,
  groupId: null,
  params: {
    curve: {
      divisions: 16,
      nodes: [
        { id: 'timewarp-node-start', t: 0, v: 0 },
        { id: 'timewarp-node-end', t: 1, v: 1 },
      ],
    },
  },
});

const createChain = (
  devices: GeneratorChain['devices'],
): GeneratorChain => ({
  devices: [
    createScannerGenerator(),
    ...devices,
  ],
  groupStateById: {},
});

const summarizePreview = (
  chain: GeneratorChain,
): Array<{ start: number; duration: number; velocity: number; pitch: number }> =>
  generatePreviewNotesData({
    chain,
    loopLengthBeats: LOOP_LENGTH_BEATS,
    launchpadModel: LAUNCHPAD_MODEL,
  }).notes.slice(0, 16).map((note) => ({
    start: Number(note.startBeat.toFixed(3)),
    duration: Number(note.durationBeats.toFixed(3)),
    velocity: note.velocity,
    pitch: note.pitch,
  }));

const buildActiveVelocityByPitchFromNotes = (
  notes: ReadonlyArray<ClipNote>,
  beat: number,
): Map<number, number> => {
  const active = new Map<number, number>();

  for (const note of notes) {
    const noteEnd = note.startBeat + note.durationBeats;
    if (!(note.startBeat <= beat && beat < noteEnd)) {
      continue;
    }

    const previous = active.get(note.pitch) ?? 0;
    if (note.velocity > previous) {
      active.set(note.pitch, note.velocity);
    }
  }

  return active;
};

test('reverse before and after color differ', () => {
  const before = summarizePreview(createChain([
    createReverseDevice(),
    createColorDevice(),
  ]));
  const after = summarizePreview(createChain([
    createColorDevice(),
    createReverseDevice(),
  ]));

  assert.notDeepEqual(before, after);
});

test('trim before and after color differ', () => {
  const before = summarizePreview(createChain([
    createTrimDevice(),
    createColorDevice(),
  ]));
  const after = summarizePreview(createChain([
    createColorDevice(),
    createTrimDevice(),
  ]));

  assert.notDeepEqual(before, after);
});

test('stretch before and after color differ', () => {
  const before = summarizePreview(createChain([
    createStretchDevice(),
    createColorDevice(),
  ]));
  const after = summarizePreview(createChain([
    createColorDevice(),
    createStretchDevice(),
  ]));

  assert.notDeepEqual(before, after);
});

test('color creates delayed follower bands for each pitch', () => {
  const preview = generatePreviewNotesData({
    chain: createChain([
      createColorDevice('color', [3, 33, 34, 35]),
    ]),
    loopLengthBeats: LOOP_LENGTH_BEATS,
    launchpadModel: LAUNCHPAD_MODEL,
  });
  const anchorPitch = preview.notes[0]?.pitch ?? null;

  assert.notEqual(anchorPitch, null);

  const anchorFollowers = preview.notes
    .filter((note) => note.pitch === anchorPitch)
    .slice(0, 4)
    .map((note) => ({
      start: Number(note.startBeat.toFixed(3)),
      velocity: note.velocity,
    }));

  assert.deepEqual(
    anchorFollowers.map((note) => note.velocity),
    [3, 33, 34, 35],
  );
  assert.ok(anchorFollowers[0].start < anchorFollowers[1].start);
  assert.ok(anchorFollowers[1].start < anchorFollowers[2].start);
  assert.ok(anchorFollowers[2].start < anchorFollowers[3].start);
});

test('time warp before and after color differ', () => {
  const before = summarizePreview(createChain([
    createTimeWarpDevice(),
    createColorDevice(),
  ]));
  const after = summarizePreview(createChain([
    createColorDevice(),
    createTimeWarpDevice(),
  ]));

  assert.notDeepEqual(before, after);
});

test('identity time warp keeps normalized occupancy after color', () => {
  const withIdentity = generatePreviewNotesData({
    chain: createChain([
      createColorDevice('color', [3, 33, 34, 35]),
      createIdentityTimeWarpDevice(),
    ]),
    loopLengthBeats: LOOP_LENGTH_BEATS,
    launchpadModel: LAUNCHPAD_MODEL,
  });
  const withoutTimeWarp = generatePreviewNotesData({
    chain: createChain([
      createColorDevice('color', [3, 33, 34, 35]),
    ]),
    loopLengthBeats: LOOP_LENGTH_BEATS,
    launchpadModel: LAUNCHPAD_MODEL,
  });

  assert.deepEqual(
    withIdentity.notes.map((note) => ({
      start: note.startBeat,
      duration: note.durationBeats,
      velocity: note.velocity,
      pitch: note.pitch,
    })),
    withoutTimeWarp.notes.map((note) => ({
      start: note.startBeat,
      duration: note.durationBeats,
      velocity: note.velocity,
      pitch: note.pitch,
    })),
  );
  assert.equal(withIdentity.sourceTimelineEndBeat, withoutTimeWarp.sourceTimelineEndBeat);
});

test('time warp after color uses the occupied note window', () => {
  const chain = createChain([
    createColorDevice('color', [3, 33, 34, 35]),
    {
      id: 'timewarp',
      kind: 'timewarp',
      enabled: true,
      groupId: null,
      params: {
        curve: {
          divisions: 16,
          nodes: [
            { id: 'timewarp-node-start', t: 0, v: 0, nextCurveBend: 1 },
            { id: 'timewarp-node-end', t: 1, v: 1 },
          ],
        },
      },
    },
  ]);
  const runtimeMap = buildRuntimeMapDataFromButtonIndex(
    getLaunchpadRuntimeMap(LAUNCHPAD_MODEL).buttonIndex,
  );
  const rawNotes = buildGeneratedNotesWithRuntimeMap({
    chain,
    loopLengthBeats: LOOP_LENGTH_BEATS,
    runtimeMap,
  }).notes;

  let firstBeat = Number.POSITIVE_INFINITY;
  let lastBeat = Number.NEGATIVE_INFINITY;
  for (const note of rawNotes) {
    firstBeat = Math.min(firstBeat, note.startBeat);
    lastBeat = Math.max(lastBeat, note.startBeat + note.durationBeats);
  }

  assert.ok(firstBeat <= 0.01);
  assert.ok(lastBeat >= 0.99);
});

test('stretch after color and time warp preserves operator order', () => {
  const colorThenTimeWarp = generatePreviewNotesData({
    chain: createChain([
      createColorDevice('color', [3, 33, 34, 35]),
      {
        id: 'timewarp',
        kind: 'timewarp',
        enabled: true,
        groupId: null,
        params: {
          curve: {
            divisions: 16,
            nodes: [
              { id: 'timewarp-node-start', t: 0, v: 0, nextCurveBend: 0.030432 },
              { id: 'curve-node-mid', t: 0.3125, v: 0.645264, nextCurveBend: 0.022655 },
              { id: 'timewarp-node-end', t: 1, v: 1 },
            ],
          },
        },
      },
      { ...createStretchDevice(), params: { start: 0.5, end: 1 } },
    ]),
    loopLengthBeats: LOOP_LENGTH_BEATS,
    launchpadModel: LAUNCHPAD_MODEL,
  });
  const timeWarpThenColor = generatePreviewNotesData({
    chain: createChain([
      {
        id: 'timewarp',
        kind: 'timewarp',
        enabled: true,
        groupId: null,
        params: {
          curve: {
            divisions: 16,
            nodes: [
              { id: 'timewarp-node-start', t: 0, v: 0, nextCurveBend: 0.030432 },
              { id: 'curve-node-mid', t: 0.3125, v: 0.645264, nextCurveBend: 0.022655 },
              { id: 'timewarp-node-end', t: 1, v: 1 },
            ],
          },
        },
      },
      createColorDevice('color', [3, 33, 34, 35]),
      { ...createStretchDevice(), params: { start: 0.5, end: 1 } },
    ]),
    loopLengthBeats: LOOP_LENGTH_BEATS,
    launchpadModel: LAUNCHPAD_MODEL,
  });

  assert.notDeepEqual(
    colorThenTimeWarp.notes.slice(0, 64).map((note) => ({
      start: note.startBeat,
      duration: note.durationBeats,
      velocity: note.velocity,
      pitch: note.pitch,
    })),
    timeWarpThenColor.notes.slice(0, 64).map((note) => ({
      start: note.startBeat,
      duration: note.durationBeats,
      velocity: note.velocity,
      pitch: note.pitch,
    })),
  );
});

test('later scene effects still affect the same origin after color and time warp', () => {
  const withoutRotate = generatePreviewNotesData({
    chain: createChain([
      createColorDevice('color', [3, 33, 34, 35]),
      createDebug3TimeWarpDevice(),
    ]),
    loopLengthBeats: LOOP_LENGTH_BEATS,
    launchpadModel: LAUNCHPAD_MODEL,
  }).notes.slice(0, 24).map((note) => ({
    start: Number(note.startBeat.toFixed(3)),
    velocity: note.velocity,
    pitch: note.pitch,
  }));
  const withRotate = generatePreviewNotesData({
    chain: createChain([
      createColorDevice('color', [3, 33, 34, 35]),
      createDebug3TimeWarpDevice(),
      { id: 'rotate', kind: 'rotate', enabled: true, groupId: null, params: { angleDeg: 18 } },
    ]),
    loopLengthBeats: LOOP_LENGTH_BEATS,
    launchpadModel: LAUNCHPAD_MODEL,
  }).notes.slice(0, 24).map((note) => ({
    start: Number(note.startBeat.toFixed(3)),
    velocity: note.velocity,
    pitch: note.pitch,
  }));

  assert.notDeepEqual(withRotate, withoutRotate);
});

test('time warp uses the visible source window before trim', () => {
  const preview = generatePreviewNotesData({
    chain: createChain([
      createDebug3TimeWarpDevice(),
      { ...createTrimDevice(), params: { start: 0.5, end: 1 } },
    ]),
    loopLengthBeats: LOOP_LENGTH_BEATS,
    launchpadModel: LAUNCHPAD_MODEL,
  });

  assert.ok(preview.notes.length > 0);
});

test('scene effects after color still work', () => {
  const rotatePreview = generatePreviewNotesData({
    chain: createChain([
      createColorDevice(),
      { id: 'rotate', kind: 'rotate', enabled: true, groupId: null, params: { angleDeg: 45 } },
    ]),
    loopLengthBeats: LOOP_LENGTH_BEATS,
    launchpadModel: LAUNCHPAD_MODEL,
  });
  const mirrorTrimPreview = generatePreviewNotesData({
    chain: createChain([
      createColorDevice(),
      { id: 'mirror', kind: 'mirror', enabled: true, groupId: null, params: { angleDeg: 45 } },
      createTrimDevice(),
    ]),
    loopLengthBeats: LOOP_LENGTH_BEATS,
    launchpadModel: LAUNCHPAD_MODEL,
  });
  const maskedPreview = generatePreviewNotesData({
    chain: createChain([
      createColorDevice(),
      {
        id: 'mask',
        kind: 'mask',
        enabled: true,
        groupId: null,
        params: {
          mode: 'include',
          tiles: [],
          sourceKind: 'tiles',
          sourceDomain: 'scene',
          sourceVisibility: 'show',
          sourceId: null,
        },
      },
    ]),
    loopLengthBeats: LOOP_LENGTH_BEATS,
    launchpadModel: LAUNCHPAD_MODEL,
  });

  assert.ok(rotatePreview.notes.length > 0);
  assert.ok(mirrorTrimPreview.notes.length > 0);
  assert.equal(maskedPreview.notes.length, 0);
});

test('a time boundary on one origin does not block later scene effects on another origin', () => {
  const chainWithoutRotate: GeneratorChain = {
    devices: [
      createScannerGenerator('generator-a', 'group-a', 0),
      createScannerGenerator('generator-b', 'group-b', 90),
      {
        ...createColorDevice(),
        id: 'color-a',
        groupId: 'group-a',
      },
      createReverseDevice('reverse-a', 'group-a'),
    ],
    groupStateById: {},
  };
  const chainWithRotate: GeneratorChain = {
    devices: [
      ...chainWithoutRotate.devices,
      {
        id: 'rotate-b',
        kind: 'rotate',
        enabled: true,
        groupId: 'group-b',
        params: { angleDeg: 45 },
      },
    ],
    groupStateById: {},
  };

  assert.notDeepEqual(
    summarizePreview(chainWithRotate),
    summarizePreview(chainWithoutRotate),
  );
});

test('mask source output follows time warp ordering', () => {
  const createMaskedChain = (
    sourceDevices: GeneratorChain['devices'],
  ): GeneratorChain => ({
    devices: [
      createScannerGenerator('generator-a', 'group-a', 0),
      ...sourceDevices,
      createScannerGenerator('generator-b', 'group-b', 90),
      {
        id: 'mask-b',
        kind: 'mask',
        enabled: true,
        groupId: 'group-b',
        params: {
          mode: 'include',
          tiles: [],
          sourceKind: 'group',
          sourceDomain: 'activation',
          sourceVisibility: 'show',
          sourceId: 'group-a',
        },
      },
    ],
    groupStateById: {},
  });

  const timeWarpBeforeColor = summarizePreview(createMaskedChain([
    { ...createTimeWarpDevice(), id: 'timewarp-a', groupId: 'group-a' },
    { ...createColorDevice('color-a'), groupId: 'group-a' },
  ]));
  const colorBeforeTimeWarp = summarizePreview(createMaskedChain([
    { ...createColorDevice('color-a'), groupId: 'group-a' },
    { ...createTimeWarpDevice(), id: 'timewarp-a', groupId: 'group-a' },
  ]));

  assert.notDeepEqual(timeWarpBeforeColor, colorBeforeTimeWarp);
});

test('generator activation mask source follows time warp ordering', () => {
  const createMaskedChain = (
    sourceDevices: GeneratorChain['devices'],
  ): GeneratorChain => ({
    devices: [
      createScannerGenerator('generator-a', 'group-a', 0),
      ...sourceDevices,
      createScannerGenerator('generator-b', 'group-b', 90),
      {
        id: 'mask-b',
        kind: 'mask',
        enabled: true,
        groupId: 'group-b',
        params: {
          mode: 'include',
          tiles: [],
          sourceKind: 'generator',
          sourceDomain: 'activation',
          sourceVisibility: 'show',
          sourceId: 'generator-a',
        },
      },
    ],
    groupStateById: {},
  });

  const timeWarpBeforeColor = summarizePreview(createMaskedChain([
    { ...createTimeWarpDevice(), id: 'timewarp-a', groupId: 'group-a' },
    { ...createColorDevice('color-a'), groupId: 'group-a' },
  ]));
  const colorBeforeTimeWarp = summarizePreview(createMaskedChain([
    { ...createColorDevice('color-a'), groupId: 'group-a' },
    { ...createTimeWarpDevice(), id: 'timewarp-a', groupId: 'group-a' },
  ]));

  assert.notDeepEqual(timeWarpBeforeColor, colorBeforeTimeWarp);
});

test('activation mask preserves authored consumer timing', () => {
  const chain: GeneratorChain = {
    devices: [
      createScannerGenerator('generator-a', 'group-a', 0),
      { ...createColorDevice('source-color', [20, 90]), groupId: 'group-a' },
      createScannerGenerator('generator-b', 'group-b', 90),
      { ...createColorDevice('consumer-color', [3, 33, 34, 35]), groupId: 'group-b' },
      {
        id: 'mask-b',
        kind: 'mask',
        enabled: true,
        groupId: 'group-b',
        params: {
          mode: 'include',
          tiles: [],
          sourceKind: 'group',
          sourceDomain: 'activation',
          sourceVisibility: 'show',
          sourceId: 'group-a',
        },
      },
    ],
    groupStateById: {},
  };

  const runtimeMap = buildRuntimeMapDataFromButtonIndex(
    getLaunchpadRuntimeMap(LAUNCHPAD_MODEL).buttonIndex,
  );
  const maskIndex = chain.devices.findIndex((device) => device.id === 'mask-b');
  const sourceChain: GeneratorChain = {
    devices: chain.devices.slice(0, maskIndex),
    groupStateById: chain.groupStateById,
  };
  const generatedSourceNotes = buildGeneratedNotesWithRuntimeMap({
    chain: sourceChain,
    loopLengthBeats: LOOP_LENGTH_BEATS,
    runtimeMap,
  }).notes.filter((note) => note.originId === 'generator-a');
  const generatedConsumerNotes = buildGeneratedNotesWithRuntimeMap({
    chain,
    loopLengthBeats: LOOP_LENGTH_BEATS,
    runtimeMap,
  }).notes.filter((note) => note.originId === 'generator-b');

  const beatTolerance = 1 / (LOOP_LENGTH_BEATS * 64);

  for (const beat of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
    const sourceTiles = new Set<number>();
    for (const sampleBeat of [beat - beatTolerance, beat, beat + beatTolerance]) {
      const clampedBeat = Math.min(1, Math.max(0, sampleBeat));
      for (const tile of resolveActiveTileIdsAtBeat(generatedSourceNotes, clampedBeat, runtimeMap)) {
        sourceTiles.add(tile);
      }
    }
    const consumerTiles = resolveActiveTileIdsAtBeat(generatedConsumerNotes, beat, runtimeMap);
    for (const tile of consumerTiles) {
      assert.ok(sourceTiles.has(tile));
    }
  }
});

test('multiple colors compose sequentially', () => {
  const doubleColor = summarizePreview(createChain([
    createColorDevice('color-a', [20, 40]),
    createColorDevice('color-b', [90, 120]),
  ]));
  const firstOnly = summarizePreview(createChain([
    createColorDevice('color-a', [20, 40]),
  ]));
  const secondOnly = summarizePreview(createChain([
    createColorDevice('color-b', [90, 120]),
  ]));

  assert.notDeepEqual(doubleColor, firstOnly);
  assert.notDeepEqual(doubleColor, secondOnly);
});

test('preview cache activation velocities match exported note velocities', () => {
  const chain = createChain([
    createColorDevice(),
    createTimeWarpDevice(),
  ]);
  const preview = generatePreviewNotesData({
    chain,
    loopLengthBeats: LOOP_LENGTH_BEATS,
    launchpadModel: LAUNCHPAD_MODEL,
  });
  const previewResult = createPreviewResultCache().resolve({
    sourceChain: chain,
    sourceKey: 'test:color-preview',
    loopLengthBeats: LOOP_LENGTH_BEATS,
    launchpadModel: LAUNCHPAD_MODEL,
  });

  const firstActiveFrameIndex = previewResult.ledFramesByIndex.findIndex((frame) => frame.size > 0);
  assert.notEqual(firstActiveFrameIndex, -1);
  const beat = toPreviewFrameBeat(
    firstActiveFrameIndex,
    previewResult.sourceTimelineEndBeat,
  );
  assert.deepEqual(
    previewResult.ledFramesByIndex[firstActiveFrameIndex],
    buildActiveVelocityByPitchFromNotes(preview.notes, beat),
  );
});
