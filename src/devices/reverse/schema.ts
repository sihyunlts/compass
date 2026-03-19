import type { ReverseEffectNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
} from '../import-hydration';
import type { RendererDeviceSchema } from '../types';

const createDefaultReverseNode = (
  id: string,
  enabled: boolean,
): ReverseEffectNode => ({
  id,
  kind: 'reverse',
  enabled: enabled !== false,
  groupId: null,
});

const hydrateImportedReverseNode = (
  source: Record<string, unknown>,
): ReverseEffectNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  return applyImportedDeviceMeta(
    createDefaultReverseNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
};

export const reverseDeviceSchema = {
  kind: 'reverse',
  label: 'Reverse',
  group: 'effect',
  createDefaultNode: createDefaultReverseNode,
  hydrateImportedNode: hydrateImportedReverseNode,
} satisfies RendererDeviceSchema<'reverse'>;
