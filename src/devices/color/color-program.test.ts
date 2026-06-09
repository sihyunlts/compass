import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildColorConfig,
  planColorProgramSlots,
  type TimedColorSource,
} from './color-program';
import type { ColorEffectNode } from '../../shared/model';

const colorConfig = {
  velocities: [32, 64],
  noteLengthPercent: 100,
  gapPercent: 100,
};

test('color program keeps zero-gap layers attached to each source frame', () => {
  const sourceSegments: TimedColorSource[] = [
    {
      startBeat: 0,
      endBeat: 0.25,
    },
  ];

  const slots = planColorProgramSlots(sourceSegments, {
    velocities: [32, 64],
    noteLengthPercent: 100,
    gapPercent: 0,
  });

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
        endBeat: 0.25,
      },
      {
        velocity: 64,
        offset: 0.25,
        startBeat: 0.25,
        endBeat: 0.5,
      },
    ],
  );
});

test('color program applies gap only between attached history layers', () => {
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

test('color program offsets whole source spans for partial layer timing', () => {
  const sourceSegments: TimedColorSource[] = [
    {
      startBeat: 0,
      endBeat: 1,
    },
  ];

  const slots = planColorProgramSlots(sourceSegments, {
    velocities: [32, 64],
    noteLengthPercent: 25,
    gapPercent: 0,
  });

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
        offset: 0.25,
        startBeat: 0.25,
        endBeat: 1.25,
      },
    ],
  );
});

test('color config treats repeated velocities as one visible color layer', () => {
  const colorEffect: ColorEffectNode = {
    id: 'c1',
    kind: 'color',
    enabled: true,
    groupId: null,
    params: {
      velocities: [3, 3, 64, 64, 3],
      noteLengthPercent: 25,
      gapPercent: 0,
    },
  };

  assert.deepEqual(buildColorConfig(colorEffect), {
    velocities: [3, 64],
    noteLengthPercent: 25,
    gapPercent: 0,
  });
});
