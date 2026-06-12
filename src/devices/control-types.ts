import type { GeneratorDeviceNode } from '../shared/model';
import type {
  RendererDeviceKind,
  RendererModulationParamDefinition,
} from './types';

export interface RendererControlChange {
  action: string;
  deviceId: string;
  paramKey?: string;
  value: unknown;
  finalize: boolean;
  label?: string;
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
  ) => readonly RendererModulationParamDefinition[];
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
