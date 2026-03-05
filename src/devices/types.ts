import type { Component } from 'svelte';

import type { GeneratorDeviceNode } from '../shared/types';

export type RendererDeviceKind = GeneratorDeviceNode['kind'];
export type RendererDeviceGroup = 'generator' | 'effect';
type DeviceOfKind<K extends RendererDeviceKind> = Extract<GeneratorDeviceNode, { kind: K }>;

export interface RendererDeviceEditorPropsBase {
  devices?: GeneratorDeviceNode[];
  paletteRevision: number;
  currentBeat?: number;
  modulationReadoutById?: Record<string, string>;
  resolvePaletteRgb: (velocity: number) => string;
}

export type RendererDeviceEditorProps<K extends RendererDeviceKind = RendererDeviceKind> =
  RendererDeviceEditorPropsBase & {
    device: DeviceOfKind<K>;
  };

export interface RendererModulationParamDefinition {
  key: string;
  label: string;
}

export interface RendererDeviceSchema<K extends RendererDeviceKind = RendererDeviceKind> {
  kind: K;
  label: string;
  group: RendererDeviceGroup;
  modulationTargetParams?: readonly RendererModulationParamDefinition[];
}

export interface RendererDeviceDefinition<K extends RendererDeviceKind = RendererDeviceKind>
  extends RendererDeviceSchema<K> {
  editor: Component<RendererDeviceEditorProps<K>>;
}
