import type { GeneratorDeviceNode } from '../shared/model';
import type {
  RendererDeviceKind,
  RendererModulationParamDefinition,
} from './types';

export type RendererControlTarget =
  | HTMLButtonElement
  | HTMLInputElement
  | HTMLSelectElement;
export type RendererControlHandler = (
  device: GeneratorDeviceNode,
  target: RendererControlTarget,
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
  resolveMergeKey: (control: RendererControlTarget) => string | null;
  resolveDefaultValue?: (
    defaultDevice: GeneratorDeviceNode,
    input: HTMLInputElement,
  ) => number | null;
}

export interface RendererKindControlDefinition {
  descriptors?: Readonly<Record<string, RendererControlDescriptor>>;
  createHandlers?: (
    context: RendererControlContext,
  ) => Readonly<Record<string, RendererControlHandler>>;
}
