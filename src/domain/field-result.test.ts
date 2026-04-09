import assert from 'node:assert/strict';
import test from 'node:test';

import { createLaunchpadExecutionRequest, createLaunchpadOutputAdapter } from '../generation/launchpad-projection';
import { buildCanonicalFieldResult } from '../generation/engine';
import type { GeneratorChain } from '../shared/model';
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
