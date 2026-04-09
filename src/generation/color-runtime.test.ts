import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRuntimeMapData } from '../domain/runtime-map';
import type { GeneratorChain, GeneratorDeviceNode } from '../shared/model';
import { buildCanonicalFieldResult } from './engine';
import {
  createLaunchpadExecutionRequest,
  createLaunchpadOutputAdapter,
} from './launchpad-projection';
import type { GeometryStroke, GeometryTimeline } from './types';

const runtimeMap = buildRuntimeMapData('mk3');
const outputAdapter = createLaunchpadOutputAdapter(runtimeMap);
const executionRequest = createLaunchpadExecutionRequest();

const colorDevice: Extract<GeneratorDeviceNode, { kind: 'color' }> = {
  id: 'c1',
  kind: 'color',
  enabled: true,
  groupId: null,
  params: {
    velocities: [32, 96],
    noteLengthPercent: 25,
    gapPercent: 0,
  },
};

const pathDevice: Extract<GeneratorDeviceNode, { kind: 'path' }> = {
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
};

const rotateDevice: Extract<GeneratorDeviceNode, { kind: 'rotate' }> = {
  id: 'r1',
  kind: 'rotate',
  enabled: true,
  groupId: null,
  params: {
    angleDeg: 90,
  },
};

const mirrorDevice: Extract<GeneratorDeviceNode, { kind: 'mirror' }> = {
  id: 'm1',
  kind: 'mirror',
  enabled: true,
  groupId: null,
  params: {
    angleDeg: 0,
  },
};

const scannerDevice: Extract<GeneratorDeviceNode, { kind: 'scanner' }> = {
  id: 's1',
  kind: 'scanner',
  enabled: true,
  groupId: null,
  params: {
    angleDeg: 30,
  },
};

const spiralDevice: Extract<GeneratorDeviceNode, { kind: 'spiral' }> = {
  id: 'sp1',
  kind: 'spiral',
  enabled: true,
  groupId: null,
  params: {
    centerX: 4.5,
    centerY: 4.5,
    turns: 2,
  },
};

const buildTimeline = (
  devices: GeneratorDeviceNode[],
): GeometryTimeline => buildCanonicalFieldResult(
  {
    name: null,
    devices,
    groupStateById: {},
  } satisfies GeneratorChain,
  4,
  outputAdapter,
  executionRequest,
).timeline;

const roundCoordinate = (value: number): number => Number(value.toFixed(6));

const toStrokeSignature = (
  stroke: GeometryStroke,
) => ({
  originId: stroke.polyline.originId,
  velocity: stroke.polyline.velocity,
  closed: stroke.polyline.closed,
  originGroupId: stroke.originGroupId,
  masks: stroke.masks.length,
  points: stroke.polyline.points.map((point) => ({
    x: roundCoordinate(point.x),
    y: roundCoordinate(point.y),
  })),
});

const toTimelineSignature = (
  timeline: GeometryTimeline,
) => timeline.frames.map((frame) => frame.strokes.map(toStrokeSignature));

const toShapeSignature = (
  stroke: GeometryStroke,
): string => JSON.stringify({
  closed: stroke.polyline.closed,
  masks: stroke.masks.length,
  points: stroke.polyline.points.map((point) => ({
    x: roundCoordinate(point.x),
    y: roundCoordinate(point.y),
  })),
});

test('color preserves upstream stroke polylines instead of creating point followers', () => {
  const timeline = buildTimeline([pathDevice, colorDevice]);
  const activeStrokes = timeline.frames.flatMap((frame) => frame.strokes);

  assert.ok(activeStrokes.length > 0);
  assert.equal(activeStrokes.every((stroke) => stroke.polyline.points.length > 1), true);
  assert.deepEqual(
    new Set(activeStrokes.map((stroke) => stroke.polyline.velocity)),
    new Set(colorDevice.params.velocities),
  );
});

test('color keeps scanner and spiral source polylines intact', () => {
  const scannerSourceTimeline = buildTimeline([scannerDevice]);
  const scannerTimeline = buildTimeline([scannerDevice, colorDevice]);
  const spiralSourceTimeline = buildTimeline([spiralDevice]);
  const spiralTimeline = buildTimeline([spiralDevice, colorDevice]);

  const scannerSourceShapes = new Set(
    scannerSourceTimeline.frames.flatMap((frame) => frame.strokes.map(toShapeSignature)),
  );
  const scannerColorShapes = scannerTimeline.frames.flatMap(
    (frame) => frame.strokes.map(toShapeSignature),
  );
  const spiralSourceShapes = new Set(
    spiralSourceTimeline.frames.flatMap((frame) => frame.strokes.map(toShapeSignature)),
  );
  const spiralColorShapes = spiralTimeline.frames.flatMap(
    (frame) => frame.strokes.map(toShapeSignature),
  );

  assert.ok(scannerColorShapes.length > 0);
  assert.ok(spiralColorShapes.length > 0);
  assert.equal(scannerColorShapes.every((shape) => scannerSourceShapes.has(shape)), true);
  assert.equal(spiralColorShapes.every((shape) => spiralSourceShapes.has(shape)), true);
});

test('rotate and color commute for history-layer cloning', () => {
  const rotatedThenColored = buildTimeline([pathDevice, rotateDevice, colorDevice]);
  const coloredThenRotated = buildTimeline([pathDevice, colorDevice, rotateDevice]);

  assert.deepEqual(
    toTimelineSignature(rotatedThenColored),
    toTimelineSignature(coloredThenRotated),
  );
});

test('mirror and color commute for history-layer cloning', () => {
  const mirroredThenColored = buildTimeline([pathDevice, mirrorDevice, colorDevice]);
  const coloredThenMirrored = buildTimeline([pathDevice, colorDevice, mirrorDevice]);

  assert.deepEqual(
    toTimelineSignature(mirroredThenColored),
    toTimelineSignature(coloredThenMirrored),
  );
});
