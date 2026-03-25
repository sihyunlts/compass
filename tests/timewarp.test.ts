import assert from 'node:assert/strict';
import test from 'node:test';

import type { SceneTemporalState } from '../src/core/core-types';
import {
  NORMALIZED_TIMELINE_WINDOW,
  composeSceneTemporalState,
  resolveSceneTemporalInputTime,
} from '../src/core/scene-operators/temporal';
import {
  createSampledRemapFromTimeWarpCurve,
  sanitizeTimeWarpCurve,
} from '../src/core/timewarp/curve';

const createIdentityTemporalState = (): SceneTemporalState => ({
  remap: { kind: 'affine', alpha: 1, beta: 0 },
  visibilityWindow: { start: 0, end: 1 },
  hasAuthoredTimeline: false,
});

const createTimeWarpState = (
  curve: Parameters<typeof sanitizeTimeWarpCurve>[0],
): SceneTemporalState =>
  composeSceneTemporalState(createIdentityTemporalState(), {
    remapToInput: createSampledRemapFromTimeWarpCurve(sanitizeTimeWarpCurve(curve)),
    visibilityWindow: NORMALIZED_TIMELINE_WINDOW,
    marksAuthoredTimeline: true,
  });

const assertClose = (
  actual: number | null,
  expected: number,
  epsilon = 0.02,
): void => {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
};

test('sanitizeTimeWarpCurve pins endpoint time and clamps values', () => {
  const sanitized = sanitizeTimeWarpCurve({
    divisions: 128,
    nodes: [
      { id: 'start', t: 0.2, v: -2 },
      { id: 'middle', t: 0.4, v: 0.7, nextCurveBend: 4 },
      { id: 'end', t: 0.8, v: 2 },
    ],
  });

  assert.equal(sanitized.divisions, 64);
  assert.deepEqual(
    sanitized.nodes.map((node) => ({ id: node.id, t: node.t, v: node.v })),
    [
      { id: 'start', t: 0, v: 0 },
      { id: 'middle', t: 0.4, v: 0.7 },
      { id: 'end', t: 1, v: 1 },
    ],
  );
  assert.equal(sanitized.nodes[1]?.nextCurveBend, 1);
});

test('identity time warp behaves as a no-op', () => {
  const state = createTimeWarpState({
    divisions: 16,
    nodes: [
      { id: 'start', t: 0, v: 0 },
      { id: 'end', t: 1, v: 1 },
    ],
  });

  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    assertClose(resolveSceneTemporalInputTime(state, t), t, 0.01);
  }
});

test('reverse-shaped time warp mirrors the timeline', () => {
  const state = createTimeWarpState({
    divisions: 16,
    nodes: [
      { id: 'start', t: 0, v: 1 },
      { id: 'end', t: 1, v: 0 },
    ],
  });

  for (const t of [0, 0.2, 0.5, 0.8, 1]) {
    assertClose(resolveSceneTemporalInputTime(state, t), 1 - t, 0.02);
  }
});

test('positive bend creates a fast-start slow-end remap', () => {
  const state = createTimeWarpState({
    divisions: 16,
    nodes: [
      { id: 'start', t: 0, v: 0, nextCurveBend: 0.8 },
      { id: 'end', t: 1, v: 1 },
    ],
  });

  const quarter = resolveSceneTemporalInputTime(state, 0.25);
  const half = resolveSceneTemporalInputTime(state, 0.5);
  assert.notEqual(quarter, null);
  assert.notEqual(half, null);
  assert.ok(quarter > 0.25);
  assert.ok(half > 0.5);
});

test('bounce-shaped time warp can revisit earlier source time', () => {
  const state = createTimeWarpState({
    divisions: 16,
    nodes: [
      { id: 'start', t: 0, v: 0 },
      { id: 'peak', t: 0.5, v: 1 },
      { id: 'end', t: 1, v: 0.3 },
    ],
  });

  const midpoint = resolveSceneTemporalInputTime(state, 0.5);
  const tail = resolveSceneTemporalInputTime(state, 0.9);
  assert.notEqual(midpoint, null);
  assert.notEqual(tail, null);
  assert.ok(midpoint > tail);
});

test('sampled time warp composes with affine reverse while staying in bounds', () => {
  const warped = createTimeWarpState({
    divisions: 16,
    nodes: [
      { id: 'start', t: 0, v: 0 },
      { id: 'mid', t: 0.5, v: 1 },
      { id: 'end', t: 1, v: 0.2 },
    ],
  });
  const reversed = composeSceneTemporalState(warped, {
    remapToInput: { kind: 'affine', alpha: -1, beta: 1 },
    visibilityWindow: NORMALIZED_TIMELINE_WINDOW,
  });

  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const resolved = resolveSceneTemporalInputTime(reversed, t);
    assert.notEqual(resolved, null);
    assert.ok(resolved >= 0 && resolved <= 1);
  }
});
