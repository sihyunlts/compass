import assert from 'node:assert/strict';
import test from 'node:test';

import { createLaunchpadExecutionRequest, createLaunchpadOutputAdapter } from '../generation/launchpad-projection';
import { buildCanonicalFieldResult } from '../generation/engine';
import type { ClipNote, GeneratorChain, LaunchpadModel } from '../shared/model';
import { buildGeneratedFieldResultWithRuntimeMap } from './field-result';
import { buildRuntimeMapData } from './runtime-map';
import {
  projectActivePitchesToNotes,
  projectTimelineToActivePitchesBySampleIndex,
} from '../generation/launchpad-projection';

const runtimeMap = buildRuntimeMapData('mk3');
const outputAdapter = createLaunchpadOutputAdapter(runtimeMap);
const executionRequest = createLaunchpadExecutionRequest();

const chain: GeneratorChain = {
  name: null,
  devices: [
    {
      id: 'p1',
      kind: 'path',
      enabled: true,
      groupId: null,
      params: {
        points: [
          { x: 2, y: 2 },
          { x: 7, y: 6 },
        ],
        closed: false,
      },
    },
    {
      id: 'c1',
      kind: 'color',
      enabled: true,
      groupId: null,
      params: {
        velocities: [32, 96],
        noteLengthPercent: 25,
        gapPercent: 0,
      },
    },
  ],
  groupStateById: {},
};

const buildScannerChain = (
  angleDeg: number,
): GeneratorChain => ({
  name: null,
  devices: [
    {
      id: 's1',
      kind: 'scanner',
      enabled: true,
      groupId: null,
      params: {
        angleDeg,
      },
    },
  ],
  groupStateById: {},
});

const buildScannerWithDefaultColorChain = (
  angleDeg: number,
  velocities: readonly number[] = [3],
): GeneratorChain => ({
  name: null,
  devices: [
    ...buildScannerChain(angleDeg).devices,
    {
      id: 'c1',
      kind: 'color',
      enabled: true,
      groupId: null,
      params: {
        velocities: [...velocities],
        noteLengthPercent: 100,
        gapPercent: 0,
      },
    },
  ],
  groupStateById: {},
});

const normalizeNoteVelocity = (
  note: ClipNote,
): ClipNote => ({
  ...note,
  velocity: 3,
});

test('field result derives notes and preview frames from the same sampled artifact', () => {
  const canonical = buildCanonicalFieldResult(
    chain,
    4,
    outputAdapter,
    executionRequest,
  );
  const activeByPitchFrames = projectTimelineToActivePitchesBySampleIndex(
    canonical.timeline,
    runtimeMap,
    canonical.mutedGroupIds,
    canonical.mutedGeneratorIds,
  );
  const directNotes = projectActivePitchesToNotes(activeByPitchFrames, canonical.timeline).map((note) => ({
    ...note,
    startBeat: note.startBeat * 4,
    durationBeats: note.durationBeats * 4,
  }));
  const directLedFrames = activeByPitchFrames.map((frame) => (
    Array.from(frame.entries()).map(([pitch, active]) => [pitch, active.velocity] as const)
  ));

  const generated = buildGeneratedFieldResultWithRuntimeMap({
    chain,
    loopLengthBeats: 4,
    runtimeMap,
  });

  assert.deepEqual(generated.notes, directNotes);
  assert.deepEqual(generated.ledFramesBySampleIndex, directLedFrames);
});

test('scanner with default color preserves generated notes and preview frame shape', () => {
  for (const launchpadModel of ['mk3', 'mk2'] satisfies LaunchpadModel[]) {
    const currentRuntimeMap = buildRuntimeMapData(launchpadModel);
    for (const angleDeg of [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165]) {
      const scanner = buildGeneratedFieldResultWithRuntimeMap({
        chain: buildScannerChain(angleDeg),
        loopLengthBeats: 4,
        runtimeMap: currentRuntimeMap,
      });
      const colored = buildGeneratedFieldResultWithRuntimeMap({
        chain: buildScannerWithDefaultColorChain(angleDeg),
        loopLengthBeats: 4,
        runtimeMap: currentRuntimeMap,
      });

      assert.deepEqual(
        colored.ledFramesBySampleIndex,
        scanner.ledFramesBySampleIndex.map((frame) => frame.map(([pitch]) => [pitch, 3] as const)),
      );
      assert.deepEqual(
        colored.notes,
        scanner.notes.map(normalizeNoteVelocity),
      );
    }
  }
});

test('scanner with repeated default color slots preserves generated notes and preview frame shape', () => {
  for (const angleDeg of [0, 30, 45, 90]) {
    const scanner = buildGeneratedFieldResultWithRuntimeMap({
      chain: buildScannerChain(angleDeg),
      loopLengthBeats: 4,
      runtimeMap,
    });
    const colored = buildGeneratedFieldResultWithRuntimeMap({
      chain: buildScannerWithDefaultColorChain(angleDeg, [3, 3, 3]),
      loopLengthBeats: 4,
      runtimeMap,
    });

    assert.deepEqual(
      colored.ledFramesBySampleIndex,
      scanner.ledFramesBySampleIndex.map((frame) => frame.map(([pitch]) => [pitch, 3] as const)),
    );
    assert.deepEqual(
      colored.notes,
      scanner.notes.map(normalizeNoteVelocity),
    );
  }
});

test('scanner color keeps frames filled when the selected paint is not the first slot', () => {
  for (const angleDeg of [0, 45, 90]) {
    const scanner = buildGeneratedFieldResultWithRuntimeMap({
      chain: buildScannerChain(angleDeg),
      loopLengthBeats: 4,
      runtimeMap,
    });
    const colored = buildGeneratedFieldResultWithRuntimeMap({
      chain: buildScannerWithDefaultColorChain(angleDeg, [3, 64]),
      loopLengthBeats: 4,
      runtimeMap,
    });

    assert.equal(
      colored.ledFramesBySampleIndex.filter((frame) => frame.length === 0).length,
      scanner.ledFramesBySampleIndex.filter((frame) => frame.length === 0).length,
    );
    assert.equal(
      colored.ledFramesBySampleIndex.some((frame) => frame.some(([, velocity]) => velocity === 64)),
      true,
    );
  }
});
