import { isGeneratorEngineNode } from '../../devices/engine';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type {
  GeneratorChain,
  GeneratorDeviceNode,
  GeneratorNode,
} from '../../shared/model';

export type OriginTimelinePolicy = 'legacy-auto-fit' | 'preserve-authored-timeline';

interface ChainOriginScope {
  originGroupIdByGeneratorId: ReadonlyMap<string, string | null>;
  upstreamOriginIds: ReadonlyArray<string>;
}

interface WalkChainOriginScopesVisitor {
  onGenerator?: (
    generator: GeneratorNode,
    deviceIndex: number,
    scope: ChainOriginScope,
  ) => void;
  onScopedDevice?: (
    device: Exclude<GeneratorDeviceNode, GeneratorNode>,
    deviceIndex: number,
    targetOriginIds: ReadonlyArray<string>,
    scope: ChainOriginScope,
  ) => void;
}

export interface ChainOriginTimelinePolicyAnalysis {
  originGroupIdByGeneratorId: Map<string, string | null>;
  originTimelinePolicyByGeneratorId: Map<string, OriginTimelinePolicy>;
}

const resolveScopedOriginIds = (
  originGroupIdByGeneratorId: ReadonlyMap<string, string | null>,
  upstreamOriginIds: ReadonlyArray<string>,
  effectGroupId: string | null | undefined,
): string[] => {
  const targetGroupId = normalizeOptionalId(effectGroupId);
  if (!targetGroupId) {
    return [...upstreamOriginIds];
  }

  return upstreamOriginIds.filter((originId) =>
    originGroupIdByGeneratorId.get(originId) === targetGroupId);
};

const buildChainOriginScope = (
  originGroupIdByGeneratorId: ReadonlyMap<string, string | null>,
  upstreamOriginIds: ReadonlyArray<string>,
): ChainOriginScope => ({
  originGroupIdByGeneratorId,
  upstreamOriginIds: [...upstreamOriginIds],
});

export const walkEnabledChainOriginScopes = (
  chain: GeneratorChain,
  visitor: WalkChainOriginScopesVisitor,
): Map<string, string | null> => {
  const upstreamOriginIds: string[] = [];
  const originGroupIdByGeneratorId = new Map<string, string | null>();

  for (let deviceIndex = 0; deviceIndex < chain.devices.length; deviceIndex += 1) {
    const device = chain.devices[deviceIndex];
    if (!isDeviceEffectivelyEnabled(chain, device)) {
      continue;
    }

    if (isGeneratorEngineNode(device)) {
      originGroupIdByGeneratorId.set(device.id, normalizeOptionalId(device.groupId));
      upstreamOriginIds.push(device.id);
      visitor.onGenerator?.(
        device,
        deviceIndex,
        buildChainOriginScope(originGroupIdByGeneratorId, upstreamOriginIds),
      );
      continue;
    }

    visitor.onScopedDevice?.(
      device,
      deviceIndex,
      resolveScopedOriginIds(originGroupIdByGeneratorId, upstreamOriginIds, device.groupId),
      buildChainOriginScope(originGroupIdByGeneratorId, upstreamOriginIds),
    );
  }

  return originGroupIdByGeneratorId;
};

export const analyzeChainOriginTimelinePolicy = (
  chain: GeneratorChain,
): ChainOriginTimelinePolicyAnalysis => {
  const originTimelinePolicyByGeneratorId = new Map<string, OriginTimelinePolicy>();
  const originGroupIdByGeneratorId = walkEnabledChainOriginScopes(chain, {
    onGenerator(generator) {
      originTimelinePolicyByGeneratorId.set(generator.id, 'legacy-auto-fit');
    },
    onScopedDevice(device, _deviceIndex, targetOriginIds) {
      if (device.kind !== 'stretch' && device.kind !== 'trim') {
        return;
      }

      for (const originId of targetOriginIds) {
        originTimelinePolicyByGeneratorId.set(originId, 'preserve-authored-timeline');
      }
    },
  });

  return {
    originGroupIdByGeneratorId,
    originTimelinePolicyByGeneratorId,
  };
};
