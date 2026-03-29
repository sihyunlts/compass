import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGeneratedFieldResult } from '../domain/field-result';
import type { GeneratorChain } from '../shared/model';

const createModulatedTranslateChain = (): GeneratorChain => ({
  name: null,
  devices: [
    {
      id: 'g1',
      kind: 'path',
      enabled: true,
      groupId: null,
      params: {
        points: [
          { x: 4, y: 1 },
          { x: 4, y: 2 },
        ],
        closed: false,
      },
    },
    {
      id: 't1',
      kind: 'translate',
      enabled: true,
      groupId: null,
      params: {
        offsetX: 0,
        offsetY: 0,
      },
    },
    {
      id: 'm1',
      kind: 'modulator',
      enabled: true,
      groupId: null,
      params: {
        amount: 4,
        target: {
          deviceId: 't1',
          paramKey: 'offsetY',
        },
        curve: {
          domain: 'loop01',
          divisions: 16,
          nodes: [
            { id: 'curve-node-start', t: 0, v: -1 },
            { id: 'curve-node-mid', t: 0.5, v: 0 },
            { id: 'curve-node-end', t: 1, v: 1 },
          ],
        },
      },
    },
  ],
  groupStateById: {},
});

const disableModulators = (chain: GeneratorChain): GeneratorChain => ({
  ...chain,
  devices: chain.devices.map((device) => (
    device.kind === 'modulator'
      ? { ...device, enabled: false }
      : device
  )),
});

test('runtime modulation affects generated note output', () => {
  const chain = createModulatedTranslateChain();
  const enabled = buildGeneratedFieldResult({
    chain,
    loopLengthBeats: 4,
    launchpadModel: 'mk3',
  });
  const disabled = buildGeneratedFieldResult({
    chain: disableModulators(chain),
    loopLengthBeats: 4,
    launchpadModel: 'mk3',
  });

  assert.notDeepEqual(enabled.notes, disabled.notes);
  assert.equal(new Set(enabled.notes.map((note) => note.pitch)).size > 1, true);
});
