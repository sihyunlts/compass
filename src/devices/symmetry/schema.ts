import type { SymmetryEffectNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
} from '../import-hydration';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_SYMMETRY_PARAMS: SymmetryEffectNode['params'] = {
  mode: 'mirror-half',
  axis: 'horizontal',
  sourceAnchor: 'bl',
};

const createDefaultSymmetryNode = (
  id: string,
  enabled: boolean,
): SymmetryEffectNode => ({
  id,
  kind: 'symmetry',
  enabled: enabled !== false,
  groupId: null,
  params: { ...DEFAULT_SYMMETRY_PARAMS },
});

const hydrateImportedSymmetryNode = (
  source: Record<string, unknown>,
): SymmetryEffectNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultSymmetryNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  device.params.mode = params.mode === 'quad-mirror'
    || params.mode === 'quad-pinwheel'
    || params.mode === 'mirror-half'
    ? params.mode
    : DEFAULT_SYMMETRY_PARAMS.mode;
  device.params.axis = params.axis === 'vertical'
    ? 'vertical'
    : DEFAULT_SYMMETRY_PARAMS.axis;
  device.params.sourceAnchor = params.sourceAnchor === 'br'
    || params.sourceAnchor === 'tr'
    || params.sourceAnchor === 'tl'
    ? params.sourceAnchor
    : DEFAULT_SYMMETRY_PARAMS.sourceAnchor;
  return device;
};

export const symmetryDeviceSchema = {
  kind: 'symmetry',
  label: 'Symmetry',
  group: 'effect',
  createDefaultNode: createDefaultSymmetryNode,
  hydrateImportedNode: hydrateImportedSymmetryNode,
} satisfies RendererDeviceSchema<'symmetry'>;
