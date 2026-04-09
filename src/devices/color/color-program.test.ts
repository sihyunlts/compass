import assert from 'node:assert/strict';
import test from 'node:test';

import {
  planColorProgramSlots,
  type TimedColorSource,
} from './color-program';

const colorConfig = {
  velocities: [32, 64],
  noteLengthPercent: 100,
  gapPercent: 100,
};

test('color program slots keep their nominal timing beyond the source span', () => {
  const sourceSegments: TimedColorSource[] = [
    {
      startBeat: 0,
      endBeat: 1,
    },
  ];

  const slots = planColorProgramSlots(sourceSegments, colorConfig);

  assert.deepEqual(
    slots.map((slot) => ({
      velocity: slot.velocity,
      offset: slot.offset,
      startBeat: slot.startBeat,
      endBeat: slot.endBeat,
    })),
    [
      {
        velocity: 32,
        offset: 0,
        startBeat: 0,
        endBeat: 1,
      },
      {
        velocity: 64,
        offset: 2,
        startBeat: 2,
        endBeat: 3,
      },
    ],
  );
});

test('color program slots do not renormalize later sources back into a shared window', () => {
  const sourceSegments: TimedColorSource[] = [
    {
      startBeat: 0,
      endBeat: 1,
    },
    {
      startBeat: 10,
      endBeat: 11,
    },
  ];

  const slots = planColorProgramSlots(sourceSegments, colorConfig);

  assert.deepEqual(
    slots.map((slot) => ({
      velocity: slot.velocity,
      offset: slot.offset,
      startBeat: slot.startBeat,
      endBeat: slot.endBeat,
    })),
    [
      {
        velocity: 32,
        offset: 0,
        startBeat: 0,
        endBeat: 1,
      },
      {
        velocity: 64,
        offset: 2,
        startBeat: 2,
        endBeat: 3,
      },
      {
        velocity: 32,
        offset: 0,
        startBeat: 10,
        endBeat: 11,
      },
      {
        velocity: 64,
        offset: 2,
        startBeat: 12,
        endBeat: 13,
      },
    ],
  );
});
