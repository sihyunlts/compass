import type { GeneratorDeviceNode } from '../shared/model';
import type { ModulationParameterDefinition } from './numeric-parameters';
import type { RendererDeviceKind } from './types';

export interface RendererControlChange {
  action: string;
  deviceId: string;
  paramKey?: string;
  value: unknown;
  finalize: boolean;
  step?: number;
}

export type RendererControlHandler = (
  device: GeneratorDeviceNode,
  change: RendererControlChange,
) => boolean;

export interface RendererControlContext {
  findDeviceById: (id: string) => GeneratorDeviceNode | null;
  getMaskSourceGroupIds: () => string[];
  getMaskSourceGeneratorIds: () => string[];
  getModulationTargetParamDefinitions: (
    kind: RendererDeviceKind,
  ) => readonly ModulationParameterDefinition[];
}

export interface RendererControlDescriptor {
  resolveMergeKey: (change: RendererControlChange) => string | null;
  resolveDefaultValue?: (
    defaultDevice: GeneratorDeviceNode,
    change: RendererControlChange,
  ) => number | null;
}

export interface RendererKindControlDefinition {
  descriptors?: Readonly<Record<string, RendererControlDescriptor>>;
  createHandlers?: (
    context: RendererControlContext,
  ) => Readonly<Record<string, RendererControlHandler>>;
}
