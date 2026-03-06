import type { CurveModulatorNode } from '../../shared/model';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_MODULATOR_PARAMS: CurveModulatorNode['params'] = {
  amount: 1,
  target: null,
  curve: {
    domain: 'loop01',
    divisions: 16,
    nodes: [
      { id: 'curve-node-start', t: 0, v: 0 },
      { id: 'curve-node-end', t: 1, v: 0 },
    ],
  },
};

export const modulatorDeviceSchema = {
  kind: 'modulator',
  label: 'Modulator',
  group: 'effect',
  numericParamKeys: ['amount'],
  createDefaultNode: (id, enabled): CurveModulatorNode => ({
    id,
    kind: 'modulator',
    enabled: enabled !== false,
    groupId: null,
    params: {
      amount: DEFAULT_MODULATOR_PARAMS.amount,
      target: DEFAULT_MODULATOR_PARAMS.target,
      curve: {
        domain: DEFAULT_MODULATOR_PARAMS.curve.domain,
        divisions: DEFAULT_MODULATOR_PARAMS.curve.divisions,
        nodes: DEFAULT_MODULATOR_PARAMS.curve.nodes.map((node) => ({ ...node })),
      },
    },
  }),
} satisfies RendererDeviceSchema<'modulator'>;
